// ─────────────────────────────────────────────────────────────
// hooks/useAuctions.ts — Auction data + actions hooks
// ─────────────────────────────────────────────────────────────

"use client";

import { useState, useEffect, useCallback } from "react";
import {
  getAllAuctions,
  getAuction,
  getArtistAuctions,
  createAuction,
  placeBid,
  finalizeAuction,
  Auction,
} from "@/lib/contract";
import { uploadImageToIPFS, uploadMetadataToIPFS, ArtworkMetadata } from "@/lib/ipfs";

// ── useAuctions ──────────────────────────────────────────────

/**
 * Fetches all auctions from the contract.
 */
export function useAuctions() {
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const all = await getAllAuctions();
      setAuctions(all);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load auctions");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { auctions, isLoading, error, refresh };
}

// ── useArtistAuctions ────────────────────────────────────────

/**
 * Fetches all auctions created by a specific artist.
 */
export function useArtistAuctions(artistPublicKey: string | null) {
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!artistPublicKey) return;
    setIsLoading(true);
    setError(null);
    try {
      const ids = await getArtistAuctions(artistPublicKey);
      const resolved = await Promise.all(ids.map((id) => getAuction(id)));
      setAuctions(resolved);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to load artist auctions"
      );
    } finally {
      setIsLoading(false);
    }
  }, [artistPublicKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { auctions, isLoading, error, refresh };
}

// ── useCreateAuction ─────────────────────────────────────────

export interface CreateAuctionInput {
  title: string;
  description: string;
  artistName: string;
  year: string;
  imageFile: File;
  reservePriceXlm: number;
  durationHours: number;
}

export function useCreateAuction(creatorPublicKey: string | null) {
  const [isCreating, setIsCreating] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(
    async (input: CreateAuctionInput): Promise<number | null> => {
      if (!creatorPublicKey) {
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
        setProgress("Creating on-chain auction…");
        const durationSeconds = input.durationHours * 3600;
        const auctionId = await createAuction(
          creatorPublicKey,
          metadataResult.cid,
          input.reservePriceXlm,
          durationSeconds
        );

        setProgress("Auction created successfully!");
        return auctionId;
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to create auction");
        return null;
      } finally {
        setIsCreating(false);
      }
    },
    [creatorPublicKey]
  );

  return { create, isCreating, progress, error };
}

// ── usePlaceBid ──────────────────────────────────────────────

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
        setError(err instanceof Error ? err.message : "Failed to place bid");
        return false;
      } finally {
        setIsBidding(false);
      }
    },
    [bidderPublicKey]
  );

  return { bid, isBidding, error };
}

// ── useFinalizeAuction ───────────────────────────────────────

export function useFinalizeAuction(callerPublicKey: string | null) {
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finalize = useCallback(
    async (auctionId: number): Promise<boolean> => {
      if (!callerPublicKey) {
        setError("Wallet not connected");
        return false;
      }
      setIsFinalizing(true);
      setError(null);
      try {
        await finalizeAuction(callerPublicKey, auctionId);
        return true;
      } catch (err: unknown) {
        setError(
          err instanceof Error ? err.message : "Failed to finalize auction"
        );
        return false;
      } finally {
        setIsFinalizing(false);
      }
    },
    [callerPublicKey]
  );

  return { finalize, isFinalizing, error };
}
