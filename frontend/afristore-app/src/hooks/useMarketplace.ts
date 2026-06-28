// ─────────────────────────────────────────────────────────────
// hooks/useMarketplace.ts — Marketplace data + actions hook
// ─────────────────────────────────────────────────────────────

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  getAllListings,
  getListing,
  getArtistListings,
  createListing,
  buyArtwork,
  cancelListing,
  updateListing,
  Listing,
  stroopsToXlm,
} from "@/lib/contract";
import { fetchListings, fetchArtistListings } from "@/lib/indexer";
import { config } from "@/lib/config";
import {
  uploadImageToIPFS,
  uploadMetadataToIPFS,
  ArtworkMetadata,
} from "@/lib/ipfs";
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
            // Fallback to on-chain scan only when indexer response is malformed
            const all = await getAllListings();
            const sorted = [...all].sort((a, b) => b.created_at - a.created_at);
            setListings(sorted);
          }
        }
      } catch (e) {
        // If indexer fails, fallback to on-chain
        const all = await getAllListings();
        const sorted = [...all].sort((a, b) => b.created_at - a.created_at);
        setListings(sorted);
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

// ── useCreateListing ──────────────────────────────────────────

export interface CreateListingInput {
  collectionAddress: string;
  nftTokenId: number;
  price: number;
  tokenAddress?: string;
}

export function useCreateListing(artistPublicKey: string | null) {
  const [isCreating, setIsCreating] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  useTransientErrorToast(error);

  const create = useCallback(
    async (input: CreateListingInput): Promise<number | null> => {
      if (!artistPublicKey) {
        setError("Wallet not connected");
        return null;
      }

      setIsCreating(true);
      setError(null);

      try {
        setProgress("Validating payment token…");
        const token = await assertSupportedTokenAddress(
          input.tokenAddress,
          "listing",
        );

        // Step 1: Call the Soroban contract.
        setProgress("Creating on-chain listing…");
        const listingId = await createListing(
          artistPublicKey,
          input.price,
          token.address,
          input.collectionAddress,
          input.nftTokenId,
        );

        // Track successful listing creation
        trackEvent.listingCreated(
          listingId,
          input.price.toString(),
          token.symbol || "XLM",
        );

        setProgress("Listing created successfully!");
        return listingId;
      } catch (err: unknown) {
        setError(getReadableErrorMessage(err, "Failed to create listing"));
        return null;
      } finally {
        setIsCreating(false);
      }
    },
    [artistPublicKey],
  );

  return { create, isCreating, progress, error };
}

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

export function useCancelListing(artistPublicKey: string | null) {
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useTransientErrorToast(error);

  const cancel = useCallback(
    async (listingId: number): Promise<boolean> => {
      if (!artistPublicKey) {
        setError("Wallet not connected");
        return false;
      }
      setIsCancelling(true);
      setError(null);
      try {
        await cancelListing(artistPublicKey, listingId);
        return true;
      } catch (err: unknown) {
        setError(getReadableErrorMessage(err, "Cancel failed"));
        return false;
      } finally {
        setIsCancelling(false);
      }
    },
    [artistPublicKey],
  );

  return { cancel, isCancelling, error };
}

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

        let imageCid = input.currentMetadata.image;

        // Step 1: Upload new image to IPFS if provided.
        if (input.imageFile) {
          setProgress("Uploading new image to IPFS…");
          const imageResult = await uploadImageToIPFS(
            input.imageFile,
            input.title,
          );
          imageCid = `ipfs://${imageResult.cid}`;
        }

        // Step 2: Build new metadata JSON.
        const metadata: ArtworkMetadata = {
          title: input.title,
          description: input.description,
          artist: input.artistName,
          image: imageCid,
          year: input.year,
          category: input.category,
        };

        // Step 3: Upload metadata to IPFS.
        setProgress("Uploading new metadata to IPFS…");
        const metadataResult = await uploadMetadataToIPFS(
          metadata,
          input.title,
        );

        // Step 4: Call the Soroban contract.
        setProgress("Updating on-chain listing…");
        const success = await updateListing(
          artistPublicKey,
          input.listingId,
          metadataResult.cid,
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
