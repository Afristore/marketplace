"use client";

import { useState, useEffect, useCallback } from "react";
import {
  getCollections,
  getCollectionsByCreator,
  getCollectionMetadata,
  deployNormal721,
  deployNormal1155,
  deployLazy721,
  deployLazy1155,
  CollectionRecord,
  CollectionMetadata,
  CollectionKind,
} from "@/lib/launchpad";
import { assertSupportedTokenAddress } from "@/lib/token-support";

const COLLECTIONS_PAGE_SIZE = 50;

// ── useLaunchpadCollections ───────────────────────────────────

export function useLaunchpadCollections() {
  const [collections, setCollections] = useState<CollectionRecord[]>([]);
  const [startIndex, setStartIndex] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const page = await getCollections(0, COLLECTIONS_PAGE_SIZE);
      setCollections(page);
      setStartIndex(COLLECTIONS_PAGE_SIZE);
      setHasMore(page.length >= COLLECTIONS_PAGE_SIZE);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to load collections",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (!hasMore || isLoading) return;
    setIsLoading(true);
    try {
      const page = await getCollections(startIndex, COLLECTIONS_PAGE_SIZE);
      setCollections((prev) => [...prev, ...page]);
      setStartIndex((prev) => prev + COLLECTIONS_PAGE_SIZE);
      setHasMore(page.length >= COLLECTIONS_PAGE_SIZE);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Failed to load more collections",
      );
    } finally {
      setIsLoading(false);
    }
  }, [startIndex, hasMore, isLoading]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { collections, isLoading, error, refresh, loadMore, hasMore };
}

// ── useCreatorCollections ─────────────────────────────────────

export function useCreatorCollections(creatorPublicKey: string | null) {
  const [collections, setCollections] = useState<CollectionRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!creatorPublicKey) return;
    setIsLoading(true);
    setError(null);
    try {
      const results = await getCollectionsByCreator(creatorPublicKey);
      setCollections(results);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load creator collections",
      );
    } finally {
      setIsLoading(false);
    }
  }, [creatorPublicKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { collections, isLoading, error, refresh };
}

// ── useCollectionDetail ───────────────────────────────────────

export function useCollectionDetail(address: string | null) {
  const [metadata, setMetadata] = useState<CollectionMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!address) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await getCollectionMetadata(address);
      setMetadata(data);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load collection metadata",
      );
    } finally {
      setIsLoading(false);
    }
  }, [address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { metadata, isLoading, error, refresh };
}

// ── useDeployCollection ───────────────────────────────────────

export interface DeployCollectionInput {
  kind: CollectionKind;
  name: string;
  symbol?: string; // only for 721
  maxSupply?: number; // only for 721
  royaltyBps: number;
  royaltyReceiver: string;
  currencyAddress: string;
  creatorPubkeyBytes?: Buffer; // only for Lazy
}

export function useDeployCollection(creatorPublicKey: string | null) {
  const [isDeploying, setIsDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deploy = useCallback(
    async (input: DeployCollectionInput): Promise<string | null> => {
      if (!creatorPublicKey) {
        setError("Wallet not connected");
        return null;
      }

      setIsDeploying(true);
      setError(null);

      try {
        const token = await assertSupportedTokenAddress(
          input.currencyAddress,
          "collection",
        );
        const salt = Buffer.alloc(32); // Simple salt for now, can be randomized
        window.crypto.getRandomValues(salt);

        let address = "";

        switch (input.kind) {
          case "Normal721":
            address = await deployNormal721(
              creatorPublicKey,
              token.address,
              input.name,
              input.symbol || "",
              input.maxSupply || 0,
              input.royaltyBps,
              input.royaltyReceiver,
              salt,
            );
            break;
          case "Normal1155":
            address = await deployNormal1155(
              creatorPublicKey,
              token.address,
              input.name,
              input.royaltyBps,
              input.royaltyReceiver,
              salt,
            );
            break;
          case "LazyMint721":
            if (!input.creatorPubkeyBytes)
              throw new Error("Missing creator pubkey bytes");
            address = await deployLazy721(
              creatorPublicKey,
              token.address,
              input.creatorPubkeyBytes,
              input.name,
              input.symbol || "",
              input.maxSupply || 0,
              input.royaltyBps,
              input.royaltyReceiver,
              salt,
            );
            break;
          case "LazyMint1155":
            if (!input.creatorPubkeyBytes)
              throw new Error("Missing creator pubkey bytes");
            address = await deployLazy1155(
              creatorPublicKey,
              token.address,
              input.creatorPubkeyBytes,
              input.name,
              input.royaltyBps,
              input.royaltyReceiver,
              salt,
            );
            break;
        }

        return address;
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Deployment failed");
        return null;
      } finally {
        setIsDeploying(false);
      }
    },
    [creatorPublicKey],
  );

  return { deploy, isDeploying, error };
}
