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
  Offer,
  Listing,
} from "@/lib/contract";

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
        })
      );

      setOffers(enriched.sort((a, b) => b.created_at - a.created_at));
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to load your offers"
      );
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

  const refresh = useCallback(async () => {
    if (listingId === null) return;
    setIsLoading(true);
    setError(null);
    try {
      const ids = await getListingOffers(listingId);
      const resolved = await Promise.all(ids.map((id) => getOffer(id)));
      setOffers(resolved.sort((a, b) => b.created_at - a.created_at));
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to load listing offers"
      );
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

  const refresh = useCallback(async () => {
    if (!ownerPublicKey) return;
    setIsLoading(true);
    setError(null);
    try {
      const listingIds = await getArtistListings(ownerPublicKey);
      const listings = await Promise.all(
        listingIds.map((id) => getListing(id))
      );

      const result: Array<{ listing: Listing; offers: Offer[] }> = [];

      // Only fetch offers for active listings.
      const activeListings = listings.filter((l) => l.status === "Active");

      await Promise.all(
        activeListings.map(async (listing) => {
          try {
            const offerIds = await getListingOffers(listing.listing_id);
            const offers = await Promise.all(
              offerIds.map((id) => getOffer(id))
            );
            result.push({
              listing,
              offers: offers.sort((a, b) => b.created_at - a.created_at),
            });
          } catch {
            // Skip listings whose offers fail to load.
          }
        })
      );

      setOffersByListing(result);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to load incoming offers"
      );
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
        setError(
          err instanceof Error ? err.message : "Failed to withdraw offer"
        );
        return false;
      } finally {
        setIsWithdrawing(false);
      }
    },
    [publicKey]
  );

  return { withdraw, isWithdrawing, error };
}

// ── useAcceptOffer ───────────────────────────────────────────

export function useAcceptOffer(publicKey: string | null) {
  const [isAccepting, setIsAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        return true;
      } catch (err: unknown) {
        setError(
          err instanceof Error ? err.message : "Failed to accept offer"
        );
        return false;
      } finally {
        setIsAccepting(false);
      }
    },
    [publicKey]
  );

  return { accept, isAccepting, error };
}

// ── useRejectOffer ───────────────────────────────────────────

export function useRejectOffer(publicKey: string | null) {
  const [isRejecting, setIsRejecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        return true;
      } catch (err: unknown) {
        setError(
          err instanceof Error ? err.message : "Failed to reject offer"
        );
        return false;
      } finally {
        setIsRejecting(false);
      }
    },
    [publicKey]
  );

  return { reject, isRejecting, error };
}
