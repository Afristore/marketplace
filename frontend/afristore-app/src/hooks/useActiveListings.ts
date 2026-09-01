// ─────────────────────────────────────────────────────────────
// hooks/useActiveListings.ts — Paginated open listings hook (#729)
// ─────────────────────────────────────────────────────────────

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { fetchListings } from "@/lib/indexer";
import { Listing } from "@/lib/contract";
import { getReadableErrorMessage } from "@/lib/errors";
import { useTransientErrorToast } from "./useTransientErrorToast";

export interface UseActiveListingsOptions {
  /** Zero-based page index */
  page?: number;
  /** Results per page */
  limit?: number;
  /** Filter by NFT collection contract ID */
  collection?: string | null;
  /** Filter by accepted currency/token type */
  currency?: string | null;
}

export interface UseActiveListingsResult {
  listings: Listing[];
  total: number | null;
  isLoading: boolean;
  error: string | null;
  /** Manually re-fetch the current page */
  refresh: () => void;
}

/** Cache keyed by serialised query params */
const cache = new Map<string, { data: Listing[]; total: number; ts: number }>();
const CACHE_TTL_MS = 30_000;

export function useActiveListings(
  opts: UseActiveListingsOptions = {},
): UseActiveListingsResult {
  const { page = 0, limit = 20, collection = null, currency = null } = opts;

  const [listings, setListings] = useState<Listing[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useTransientErrorToast(error);

  const refresh = useCallback(() => {
    const cacheKey = JSON.stringify({ page, limit, collection, currency });
    const cached = cache.get(cacheKey);

    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
      setListings(cached.data);
      setTotal(cached.total);
      return;
    }

    // Cancel any in-flight request
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        const offset = page * limit;
        const res = await fetchListings({
          status: "Active",
          limit,
          offset,
          ...(collection ? { collection } : {}),
          ...(currency ? { currency } : {}),
        });

        const data = (res.listings ?? []) as Listing[];
        const tot = res.total ?? data.length;

        cache.set(cacheKey, { data, total: tot, ts: Date.now() });
        setListings(data);
        setTotal(tot);
      } catch (err: unknown) {
        if ((err as { name?: string }).name === "AbortError") return;
        setError(
          getReadableErrorMessage(err, "Failed to load active listings"),
        );
      } finally {
        setIsLoading(false);
      }
    })();
  }, [page, limit, collection, currency]);

  useEffect(() => {
    refresh();
    return () => {
      abortRef.current?.abort();
    };
  }, [refresh]);

  return { listings, total, isLoading, error, refresh };
}
