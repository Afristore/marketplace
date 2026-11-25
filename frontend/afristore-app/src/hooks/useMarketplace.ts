// ─────────────────────────────────────────────────────────────
// hooks/useMarketplace.ts — Marketplace data + actions hook
// ─────────────────────────────────────────────────────────────

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  getAllListings,
  getListing,
  getArtistListings,
  buyArtwork,
  updateListing,
  Listing,
  stroopsToXlm,
} from "@/lib/contract";
import {
  fetchListings,
  fetchArtistListings,
  fetchOwnedListings,
} from "@/lib/indexer";
import { config } from "@/lib/config";
import { ArtworkMetadata } from "@/lib/ipfs";
import { getReadableErrorMessage } from "@/lib/errors";
import { useTransientErrorToast } from "./useTransientErrorToast";
import { assertSupportedTokenAddress } from "@/lib/token-support";
import { trackEvent } from "@/providers/PostHogProvider";

// ── Listing with resolved metadata ───────────────────────────

export interface EnrichedListing extends Listing {
  metadataUrl: string;
}

// ── useMarketplace ────────────────────────────────────────────

export function useMarketplace(opts?: { page?: number; limit?: number }) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useTransientErrorToast(error);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // Prefer indexer results when available
      try {
        if (opts && (opts.page || opts.limit)) {
          const limit = opts.limit || 50;
          const offset = opts.page ? (opts.page - 1) * limit : 0;
          const res = await fetchListings({ status: "Active", limit, offset });
          const rows = Array.isArray(res.listings) ? res.listings : [];
          const sorted = [...rows].sort((a, b) => b.created_at - a.created_at);
          setListings(sorted);
        } else {
          const res = await fetchListings({ status: "Active", limit: 1000 });
          if (Array.isArray(res.listings)) {
            const sorted = [...res.listings].sort(
              (a, b) => b.created_at - a.created_at,
            );
            setListings(sorted);
          } else {
            // Indexer response is malformed
            throw new Error("Indexer response is malformed");
          }
        }
      } catch (e) {
        // Indexer failed
        throw e;
      }
    } catch (err: unknown) {
      setError(getReadableErrorMessage(err, "Failed to load listings"));
    } finally {
      setIsLoading(false);
    }
  }, [opts]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Subscribe to real-time updates via SSE (issue #161).
  useEffect(() => {
    if (typeof window === "undefined" || !config.indexerUrl) return;
    const es = new EventSource(`${config.indexerUrl}/events/stream`);
    es.onmessage = () => {
      refresh();
    };
    es.onerror = () => {
      es.close();
    };
    return () => es.close();
  }, [refresh]);

  return { listings, isLoading, error, refresh };
}

// ── useArtistListings ─────────────────────────────────────────

export function useArtistListings(artistPublicKey: string | null) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useTransientErrorToast(error);

  const refresh = useCallback(async () => {
    if (!artistPublicKey) return;
    setIsLoading(true);
    setError(null);
    try {
      try {
        const raw = await fetchArtistListings(artistPublicKey);
        if (raw && raw.length >= 0) {
          setListings(
            raw.sort((a: any, b: any) => b.created_at - a.created_at),
          );
          return;
        }
      } catch (e) {
        console.warn("[indexer] useArtistListings fallback:", e);
      }

      const ids = await getArtistListings(artistPublicKey);
      const resolved = await Promise.all(ids.map((id) => getListing(id)));
      setListings(resolved.sort((a, b) => b.created_at - a.created_at));
    } catch (err: unknown) {
      setError(getReadableErrorMessage(err, "Failed to load artist listings"));
    } finally {
      setIsLoading(false);
    }
  }, [artistPublicKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { listings, isLoading, error, refresh };
}

// ── useOwnedListings ──────────────────────────────────────────

/**
 * Listings currently owned by `ownerPublicKey`, including `Sold` ones.
 *
 * Purchases flip a listing to `Sold` and set `owner` to the buyer, so the
 * Active-only feed from `useMarketplace()` can never contain a wallet's
 * purchases. Query the indexer by owner instead.
 */
export function useOwnedListings(ownerPublicKey: string | null) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useTransientErrorToast(error);

  const refresh = useCallback(async () => {
    if (!ownerPublicKey) {
      setListings([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const rows = await fetchOwnedListings(ownerPublicKey);
      setListings(
        [...rows].sort((a, b) => Number(b.created_at) - Number(a.created_at)),
      );
    } catch (err: unknown) {
      setError(getReadableErrorMessage(err, "Failed to load owned artworks"));
    } finally {
      setIsLoading(false);
    }
  }, [ownerPublicKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { listings, isLoading, error, refresh };
}

// ── useCreateListing ──────────────────────────────────────────
// Extracted into hooks/mutations/useCreateListing.ts (issue #737) to
// follow the hooks/mutations/* convention. Re-exported here so existing
// `@/hooks/useMarketplace` importers keep working unchanged.

export {
  useCreateListing,
  type CreateListingInput,
} from "./mutations/useCreateListing";

// ── useBuyArtwork ─────────────────────────────────────────────

export function useBuyArtwork(buyerPublicKey: string | null) {
  const [isBuying, setIsBuying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useTransientErrorToast(error);

  const buy = useCallback(
    async (listingId: number): Promise<boolean> => {
      if (!buyerPublicKey) {
        setError("Wallet not connected");
        return false;
      }
      setIsBuying(true);
      setError(null);
      try {
        // Get listing details for tracking
        const listing = await getListing(listingId);
        await buyArtwork(buyerPublicKey, listingId);

        // Track successful purchase
        trackEvent.purchaseSuccessful(
          listingId,
          stroopsToXlm(listing.price),
          listing.currency || "XLM",
        );

        return true;
      } catch (err: unknown) {
        setError(getReadableErrorMessage(err, "Purchase failed"));
        return false;
      } finally {
        setIsBuying(false);
      }
    },
    [buyerPublicKey],
  );

  return { buy, isBuying, error };
}

// ── useCancelListing ──────────────────────────────────────────
// Extracted into hooks/mutations/useCancelListing.ts (issue #738) to
// follow the hooks/mutations/* convention. Re-exported here so existing
// `@/hooks/useMarketplace` importers keep working unchanged.

export { useCancelListing } from "./mutations/useCancelListing";

// ── useUpdateListing ──────────────────────────────────────────

export interface UpdateListingInput {
  listingId: number;
  title: string;
  description: string;
  artistName: string;
  year: string;
  category: string;
  price: number;
  originalTokenAddress: string;
  tokenAddress: string;
  imageFile?: File; // Optional: only if updating the image
  currentMetadata: ArtworkMetadata;
  /** CID currently on the listing; reused when the metadata is unchanged. */
  currentMetadataCid?: string;
}

/** True when the submitted artwork fields differ from what is pinned. */
export function metadataChanged(input: UpdateListingInput): boolean {
  const m = input.currentMetadata;
  return (
    !!input.imageFile ||
    input.title !== m.title ||
    input.description !== m.description ||
    input.artistName !== m.artist ||
    input.year !== m.year ||
    input.category !== m.category
  );
}

export function useUpdateListing(artistPublicKey: string | null) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  useTransientErrorToast(error);

  const update = useCallback(
    async (input: UpdateListingInput): Promise<boolean> => {
      if (!artistPublicKey) {
        setError("Wallet not connected");
        return false;
      }

      setIsUpdating(true);
      setError(null);

      try {
        if (input.tokenAddress !== input.originalTokenAddress) {
          throw new Error(
            "Updating the payment token for an existing listing is not supported.",
          );
        }

        setProgress("Validating payment token…");
        const token = await assertSupportedTokenAddress(
          input.tokenAddress,
          "listing",
        );

        if (metadataChanged(input)) {
          throw new Error(
            "Metadata changes require a dedicated on-chain metadata update; update_listing only supports price and recipient changes.",
          );
        }

        // Step 4: Call the Soroban contract.
        setProgress("Updating on-chain listing…");
        const success = await updateListing(
          artistPublicKey,
          input.listingId,
          input.price,
          token.address,
        );

        setProgress("Listing updated successfully!");
        return success;
      } catch (err: unknown) {
        setError(getReadableErrorMessage(err, "Failed to update listing"));
        return false;
      } finally {
        setIsUpdating(false);
      }
    },
    [artistPublicKey],
  );

  return { update, isUpdating, progress, error };
}

// ── useAuction ────────────────────────────────────────────────

import { getAuction, placeBid, Auction } from "@/lib/contract";

export function useAuction(auctionId: number | null) {
  const [auction, setAuction] = useState<Auction | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useTransientErrorToast(error);

  const refresh = useCallback(async () => {
    if (auctionId === null) return;
    setIsLoading(true);
    setError(null);
    try {
      const a = await getAuction(auctionId);
      setAuction(a);
    } catch (err: unknown) {
      setError(getReadableErrorMessage(err, "Failed to load auction"));
    } finally {
      setIsLoading(false);
    }
  }, [auctionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { auction, isLoading, error, refresh };
}
