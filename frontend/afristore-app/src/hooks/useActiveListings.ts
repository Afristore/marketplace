"use client";

import { useState, useEffect, useCallback } from "react";
import { config } from "@/lib/config";
import { getReadableErrorMessage } from "@/lib/errors";
import { useTransientErrorToast } from "./useTransientErrorToast";

export interface IndexedLendingListing {
  listingId: string;
  lender: string;
  nftContract: string;
  tokenId: string;
  declaredPriceUsd: string;
  interestScheduleBps: number[];
  maxDurationDays: number;
  minCollateralBufferBps: number;
  liquidationThresholdBps: number;
  status: "Open" | "Filled" | "Cancelled";
  name?: string;
}

export interface UseActiveListingsOptions {
  page?: number;
  limit?: number;
  collection?: string | null;
  currency?: string | null;
}

export interface UseActiveListingsResult {
  listings: IndexedLendingListing[];
  total: number | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

export function useActiveListings(
  opts: UseActiveListingsOptions = {},
): UseActiveListingsResult {
  const { page = 0, limit = 20, collection = null, currency = null } = opts;
  const [listings, setListings] = useState<IndexedLendingListing[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  useTransientErrorToast(error);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    const query = new URLSearchParams({
      limit: String(limit),
      offset: String(page * limit),
    });
    if (collection) query.set("collection", collection);
    if (currency) query.set("currency", currency);
    async function load() {
      try {
        const response = await fetch(
          `${config.indexerUrl}/api/lending/listings?${query}`,
          { signal: controller.signal },
        );
        if (!response.ok)
          throw new Error(
            `Failed to load lending listings (HTTP ${response.status})`,
          );
        const data: { listings: IndexedLendingListing[]; total: number } =
          await response.json();
        if (!controller.signal.aborted) {
          setListings(
            data.listings.filter((listing) => listing.status === "Open"),
          );
          setTotal(data.total);
        }
      } catch (error) {
        if (!controller.signal.aborted)
          setError(
            getReadableErrorMessage(error, "Failed to load lending listings"),
          );
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [page, limit, collection, currency, revision]);

  return { listings, total, isLoading, error, refresh };
}
