// ─────────────────────────────────────────────────────────────
// hooks/useOffers.ts — Offer data + actions hooks
// ─────────────────────────────────────────────────────────────

"use client";

import { useState, useEffect, useCallback } from "react";
import {
  getOffer,
  getOffererOffers,
  getListingOffers,
  getArtistListings,
  getListing,
  withdrawOffer,
  acceptOffer,
  rejectOffer,
  makeOffer,
  Offer,
  Listing,
} from "@/lib/contract";
import { getReadableErrorMessage } from "@/lib/errors";
import { useTransientErrorToast } from "./useTransientErrorToast";

// ── useOffererOffers ─────────────────────────────────────────

/**
 * Fetches all offers placed by a user, enriched with listing data.
 */
export interface OffererOffer extends Offer {
  listing?: Listing;
}

export function useOffererOffers(publicKey: string | null) {
  const [offers, setOffers] = useState<OffererOffer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useTransientErrorToast(error);

  const refresh = useCallback(async () => {
    if (!publicKey) return;
    setIsLoading(true);
    setError(null);
    try {
      const ids = await getOffererOffers(publicKey);
      const resolved = await Promise.all(ids.map((id) => getOffer(id)));

      // Enrich each offer with its listing data.
      const enriched: OffererOffer[] = await Promise.all(
        resolved.map(async (offer) => {
          try {
            const listing = await getListing(offer.listing_id);
            return { ...offer, listing };
          } catch {
            return { ...offer };
          }
        }),
      );

      setOffers(enriched.sort((a, b) => b.created_at - a.created_at));
    } catch (err: unknown) {
      setError(getReadableErrorMessage(err, "Failed to load your offers"));
    } finally {
      setIsLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { offers, isLoading, error, refresh };
}

// ── useListingOffers ─────────────────────────────────────────

/**
 * Fetches all offers for a specific listing.
 */
export function useListingOffers(listingId: number | null) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useTransientErrorToast(error);

  const refresh = useCallback(async () => {
    if (listingId === null) return;
    setIsLoading(true);
    setError(null);
    try {
      const ids = await getListingOffers(listingId);
      const resolved = await Promise.all(ids.map((id) => getOffer(id)));
      setOffers(resolved.sort((a, b) => b.created_at - a.created_at));
    } catch (err: unknown) {
      setError(getReadableErrorMessage(err, "Failed to load listing offers"));
    } finally {
      setIsLoading(false);
    }
  }, [listingId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { offers, isLoading, error, refresh };
}

// ── useIncomingOffers ────────────────────────────────────────

/**
 * Fetches offers on all listings owned by the user.
 * Gets the artist's listings, then for each active listing, fetches its offers.
 */
export function useIncomingOffers(ownerPublicKey: string | null) {
  const [offersByListing, setOffersByListing] = useState<
    Array<{ listing: Listing; offers: Offer[] }>
  >([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useTransientErrorToast(error);

  const refresh = useCallback(async () => {
    if (!ownerPublicKey) return;
    setIsLoading(true);
    setError(null);
    try {
      const listingIds = await getArtistListings(ownerPublicKey);
      const listings = await Promise.all(
        listingIds.map((id) => getListing(id)),
      );

      const result: Array<{ listing: Listing; offers: Offer[] }> = [];

      // Only fetch offers for active listings.
      const activeListings = listings.filter((l) => l.status === "Active");

      await Promise.all(
        activeListings.map(async (listing) => {
          try {
            const offerIds = await getListingOffers(listing.listing_id);
            const offers = await Promise.all(
              offerIds.map((id) => getOffer(id)),
            );
            const sortedOffers = [...offers].sort((a, b) => {
              if (a.status === "Pending" && b.status !== "Pending") return -1;
              if (a.status !== "Pending" && b.status === "Pending") return 1;
              return b.created_at - a.created_at;
            });
            result.push({
              listing,
              offers: sortedOffers,
            });
          } catch {
            // Skip listings whose offers fail to load.
          }
        }),
      );

      // Prioritize listing groups with pending offers needing review
      result.sort((a, b) => {
        const aPending = a.offers.some((o) => o.status === "Pending");
        const bPending = b.offers.some((o) => o.status === "Pending");
        if (aPending && !bPending) return -1;
        if (!aPending && bPending) return 1;
        return b.listing.listing_id - a.listing.listing_id;
      });

      setOffersByListing(result);
    } catch (err: unknown) {
      setError(getReadableErrorMessage(err, "Failed to load incoming offers"));
    } finally {
      setIsLoading(false);
    }
  }, [ownerPublicKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { offersByListing, isLoading, error, refresh };
}

// ── useWithdrawOffer ─────────────────────────────────────────

export function useWithdrawOffer(publicKey: string | null) {
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useTransientErrorToast(error);

  const withdraw = useCallback(
    async (offerId: number): Promise<boolean> => {
      if (!publicKey) {
        setError("Wallet not connected");
        return false;
      }
      setIsWithdrawing(true);
      setError(null);
      try {
        await withdrawOffer(publicKey, offerId);
        return true;
      } catch (err: unknown) {
        setError(getReadableErrorMessage(err, "Failed to withdraw offer"));
        return false;
      } finally {
        setIsWithdrawing(false);
      }
    },
    [publicKey],
  );

  return { withdraw, isWithdrawing, error };
}

// ── useAcceptOffer ───────────────────────────────────────────

export function useAcceptOffer(
  publicKey: string | null,
  onRefresh?: () => Promise<void> | void,
) {
  const [isAccepting, setIsAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useTransientErrorToast(error);

  const accept = useCallback(
    async (offerId: number): Promise<boolean> => {
      if (!publicKey) {
        setError("Wallet not connected");
        return false;
      }
      setIsAccepting(true);
      setError(null);
      try {
        await acceptOffer(publicKey, offerId);
        await onRefresh?.(); // #1286: invalidate offers cache on accept
        return true;
      } catch (err: unknown) {
        setError(getReadableErrorMessage(err, "Failed to accept offer"));
        return false;
      } finally {
        setIsAccepting(false);
      }
    },
    [publicKey, onRefresh],
  );

  return { accept, isAccepting, error };
}

// ── useRejectOffer ───────────────────────────────────────────

export function useRejectOffer(
  publicKey: string | null,
  onRefresh?: () => Promise<void> | void,
) {
  const [isRejecting, setIsRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useTransientErrorToast(error);

  const reject = useCallback(
    async (offerId: number): Promise<boolean> => {
      if (!publicKey) {
        setError("Wallet not connected");
        return false;
      }
      setIsRejecting(true);
      setError(null);
      try {
        await rejectOffer(publicKey, offerId);
        await onRefresh?.(); // #1286: invalidate offers cache on reject
        return true;
      } catch (err: unknown) {
        setError(getReadableErrorMessage(err, "Failed to reject offer"));
        return false;
      } finally {
        setIsRejecting(false);
      }
    },
    [publicKey, onRefresh],
  );

  return { reject, isRejecting, error };
}

// ── useMakeOffer ─────────────────────────────────────────────

export function useMakeOffer(publicKey: string | null) {
  const [isOffering, setIsOffering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useTransientErrorToast(error);

  const make = useCallback(
    async (
      listingId: number,
      amountXlm: number,
      tokenAddress: string,
    ): Promise<boolean> => {
      if (!publicKey) {
        setError("Wallet not connected");
        return false;
      }
      setIsOffering(true);
      setError(null);
      try {
        await makeOffer(publicKey, listingId, amountXlm, tokenAddress);
        return true;
      } catch (err: unknown) {
        setError(getReadableErrorMessage(err, "Failed to make offer"));
        return false;
      } finally {
        setIsOffering(false);
      }
    },
    [publicKey],
  );

  return { make, isOffering, error };
}
