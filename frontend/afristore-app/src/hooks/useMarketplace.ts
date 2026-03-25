// ─────────────────────────────────────────────────────────────
// hooks/useMarketplace.ts — Marketplace data + actions hook
// ─────────────────────────────────────────────────────────────

"use client";

import { useState, useEffect, useCallback } from "react";
import {
  getAllListings,
  getListing,
  getArtistListings,
  createListing,
  buyArtwork,
  cancelListing,
  updateListing,
  Listing,
} from "@/lib/contract";
import { uploadImageToIPFS, uploadMetadataToIPFS, ArtworkMetadata } from "@/lib/ipfs";

// ── Listing with resolved metadata ───────────────────────────

export interface EnrichedListing extends Listing {
  metadataUrl: string;
}

// ── useMarketplace ────────────────────────────────────────────

export function useMarketplace() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const all = await getAllListings();
      // Show active listings first.
      const sorted = [...all].sort((a, b) => b.created_at - a.created_at);
      setListings(sorted);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load listings");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { listings, isLoading, error, refresh };
}

// ── useArtistListings ─────────────────────────────────────────

export function useArtistListings(artistPublicKey: string | null) {
  const [listings, setListings] = useState<Listing[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!artistPublicKey) return;
    setIsLoading(true);
    setError(null);
    try {
      const ids = await getArtistListings(artistPublicKey);
      const resolved = await Promise.all(ids.map((id) => getListing(id)));
      setListings(resolved.sort((a, b) => b.created_at - a.created_at));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load artist listings");
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
  title: string;
  description: string;
  artistName: string;
  year: string;
  price: number;
  tokenAddress?: string;
  royaltyBps?: number;
  imageFile: File;
}

export function useCreateListing(artistPublicKey: string | null) {
  const [isCreating, setIsCreating] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(
    async (input: CreateListingInput): Promise<number | null> => {
      if (!artistPublicKey) {
        setError("Wallet not connected");
        return null;
      }

      setIsCreating(true);
      setError(null);

      try {
        // Step 1: Upload image to IPFS.
        setProgress("Uploading image to IPFS…");
        const imageResult = await uploadImageToIPFS(input.imageFile, input.title);

        // Step 2: Build metadata JSON.
        const metadata: ArtworkMetadata = {
          title: input.title,
          description: input.description,
          artist: input.artistName,
          image: `ipfs://${imageResult.cid}`,
          year: input.year,
        };

        // Step 3: Upload metadata to IPFS.
        setProgress("Uploading metadata to IPFS…");
        const metadataResult = await uploadMetadataToIPFS(metadata, input.title);

        // Step 4: Call the Soroban contract.
        setProgress("Creating on-chain listing…");
        const listingId = await createListing(
          artistPublicKey,
          metadataResult.cid,
          input.price,
          input.tokenAddress,
          input.royaltyBps
        );

        setProgress("Listing created successfully!");
        return listingId;
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to create listing");
        return null;
      } finally {
        setIsCreating(false);
      }
    },
    [artistPublicKey]
  );

  return { create, isCreating, progress, error };
}

// ── useBuyArtwork ─────────────────────────────────────────────

export function useBuyArtwork(buyerPublicKey: string | null) {
  const [isBuying, setIsBuying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buy = useCallback(
    async (listingId: number): Promise<boolean> => {
      if (!buyerPublicKey) {
        setError("Wallet not connected");
        return false;
      }
      setIsBuying(true);
      setError(null);
      try {
        await buyArtwork(buyerPublicKey, listingId);
        return true;
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Purchase failed");
        return false;
      } finally {
        setIsBuying(false);
      }
    },
    [buyerPublicKey]
  );

  return { buy, isBuying, error };
}

// ── useCancelListing ──────────────────────────────────────────

export function useCancelListing(artistPublicKey: string | null) {
  const [isCancelling, setIsCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        setError(err instanceof Error ? err.message : "Cancel failed");
        return false;
      } finally {
        setIsCancelling(false);
      }
    },
    [artistPublicKey]
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
  price: number;
  tokenAddress: string;
  imageFile?: File; // Optional: only if updating the image
  currentMetadata: ArtworkMetadata;
}

export function useUpdateListing(artistPublicKey: string | null) {
  const [isUpdating, setIsUpdating] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const update = useCallback(
    async (input: UpdateListingInput): Promise<boolean> => {
      if (!artistPublicKey) {
        setError("Wallet not connected");
        return false;
      }

      setIsUpdating(true);
      setError(null);

      try {
        let imageCid = input.currentMetadata.image;

        // Step 1: Upload new image to IPFS if provided.
        if (input.imageFile) {
          setProgress("Uploading new image to IPFS…");
          const imageResult = await uploadImageToIPFS(input.imageFile, input.title);
          imageCid = `ipfs://${imageResult.cid}`;
        }

        // Step 2: Build new metadata JSON.
        const metadata: ArtworkMetadata = {
          title: input.title,
          description: input.description,
          artist: input.artistName,
          image: imageCid,
          year: input.year,
        };

        // Step 3: Upload metadata to IPFS.
        setProgress("Uploading new metadata to IPFS…");
        const metadataResult = await uploadMetadataToIPFS(metadata, input.title);

        // Step 4: Call the Soroban contract.
        setProgress("Updating on-chain listing…");
        const success = await updateListing(
          artistPublicKey,
          input.listingId,
          metadataResult.cid,
          input.price,
          input.tokenAddress
        );

        setProgress("Listing updated successfully!");
        return success;
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to update listing");
        return false;
      } finally {
        setIsUpdating(false);
      }
    },
    [artistPublicKey]
  );

  return { update, isUpdating, progress, error };
}

// ── useAuction ────────────────────────────────────────────────

import { getAuction, placeBid, Auction } from "@/lib/contract";

export function useAuction(auctionId: number | null) {
  const [auction, setAuction] = useState<Auction | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (auctionId === null) return;
    setIsLoading(true);
    setError(null);
    try {
      const a = await getAuction(auctionId);
      setAuction(a);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load auction");
    } finally {
      setIsLoading(false);
    }
  }, [auctionId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { auction, isLoading, error, refresh };
}

// ── usePlaceBid ───────────────────────────────────────────────

export function usePlaceBid(bidderPublicKey: string | null) {
  const [isBidding, setIsBidding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bid = useCallback(
    async (auctionId: number, amountXlm: number): Promise<boolean> => {
      if (!bidderPublicKey) {
        setError("Wallet not connected");
        return false;
      }
      setIsBidding(true);
      setError(null);
      try {
        await placeBid(bidderPublicKey, auctionId, amountXlm);
        return true;
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Bid failed");
        return false;
      } finally {
        setIsBidding(false);
      }
    },
    [bidderPublicKey]
  );

  return { bid, isBidding, error };
}
