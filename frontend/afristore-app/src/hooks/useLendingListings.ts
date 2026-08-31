// ─────────────────────────────────────────────────────────────
// hooks/useLendingListings.ts — Open lending offers from indexer
// ─────────────────────────────────────────────────────────────
// Fetches open lending listings from the indexer
// (GET /api/lending/listings) and normalizes them into the
// `LendingOffer` shape consumed by the lending UI components.
//──────────────────────────────────────────────────────────────

"use client";

import { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { config } from "@/lib/config";
import type { LendingOffer } from "@/components/lending/types";

/** Raw lending listing row as returned by the indexer API. */
interface IndexerLendingListingRow {
  listingId?: string | number;
  lender?: string;
  nftContract?: string;
  tokenId?: string | number | null;
  declaredPriceUsd?: unknown;
  interestScheduleBps?: number[];
  maxDurationDays?: number;
  minCollateralBufferBps?: number;
  liquidationThresholdBps?: number;
  status?: string;
  createdAtLedger?: number;
}

/**
 * Parses a 7-decimal USD string (e.g. "100.0000000") into the
 * contract's fixed-point bigint units (1 USD = 10_000_000).
 */
function parseUsdFixedPoint(value: unknown): bigint {
  if (value === null || value === undefined) return 0n;
  const str = String(value).trim();
  const match = /^(-?\d+)(?:\.(\d+))?$/.exec(str);
  if (!match) return 0n;
  const sign = match[1].startsWith("-") ? -1n : 1n;
  const whole = match[1].replace("-", "");
  const frac = (match[2] ?? "").padEnd(7, "0").slice(0, 7);
  return sign * BigInt(`${whole}${frac}` || "0");
}

/** Maps an indexer row to a LendingOffer (only Open listings). */
function normalizeLendingListing(
  row: IndexerLendingListingRow,
): LendingOffer | null {
  if (row.listingId === undefined || row.listingId === null) return null;
  const status = typeof row.status === "string" ? row.status : "Open";
  if (status !== "Open") return null;

  return {
    id: BigInt(row.listingId),
    lender: String(row.lender ?? ""),
    nft_contract: String(row.nftContract ?? ""),
    token_id: row.tokenId !== null && row.tokenId !== undefined
      ? Number(row.tokenId)
      : 0,
    declared_price_usd: parseUsdFixedPoint(row.declaredPriceUsd),
    interest_schedule_bps: Array.isArray(row.interestScheduleBps)
      ? (row.interestScheduleBps as number[])
      : [],
    max_duration_days: Number(row.maxDurationDays ?? 0),
    min_collateral_buffer_bps: Number(row.minCollateralBufferBps ?? 0),
    liquidation_threshold_bps: Number(row.liquidationThresholdBps ?? 0),
    status: "Open",
    created_at: Number(row.createdAtLedger ?? 0),
  };
}

interface UseLendingListings {
  listings: LendingOffer[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useLendingListings(): UseLendingListings {
  const [listings, setListings] = useState<LendingOffer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await axios.get<{ listings?: IndexerLendingListingRow[] }>(
        `${config.indexerUrl}/api/lending/listings`,
        { timeout: 12_000 },
      );
      const rows = Array.isArray(res.data?.listings)
        ? res.data.listings
        : [];
      const offers = rows
        .map(normalizeLendingListing)
        .filter((offer): offer is LendingOffer => offer !== null);
      setListings(offers);
    } catch (err: unknown) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load lending listings",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { listings, isLoading, error, refresh };
}