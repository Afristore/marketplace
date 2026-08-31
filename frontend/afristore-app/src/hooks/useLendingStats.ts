import { useCallback, useEffect, useState } from "react";

/**
 * Protocol-wide lending statistics.
 *
 * `tvlUsd` / `volumeUsd` are USD amounts in the protocol's canonical
 * 7-decimal fixed-point representation (`USD_DECIMALS = 10_000_000n` in
 * `@/lib/lendingMath`), matching the Soroban i128 values surfaced elsewhere
 * in the lending UI. `activeLoans` is a plain count.
 */
export type LendingStats = {
  /** Total value locked across all lending pools, 7-decimal fixed-point USD. */
  tvlUsd: bigint;
  /** Number of borrow positions currently open. */
  activeLoans: number;
  /** Cumulative borrow volume, 7-decimal fixed-point USD. */
  volumeUsd: bigint;
};

type UseLendingStats = {
  stats: LendingStats | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
};

export function useLendingStats(): UseLendingStats {
  const [stats, setStats] = useState<LendingStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/lending/stats", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setStats({
        tvlUsd: BigInt(data.tvlUsd ?? 0),
        activeLoans: Number(data.activeLoans ?? 0),
        volumeUsd: BigInt(data.volumeUsd ?? 0),
      });
    } catch (e: any) {
      setError(e.message || "Failed to fetch lending stats");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return { stats, loading, error, refetch: fetchStats };
// ─────────────────────────────────────────────────────────────
// hooks/useLendingStats.ts — Platform-wide lending metrics (#728)
// ─────────────────────────────────────────────────────────────

"use client";

import { useState, useEffect, useCallback } from "react";
import { getReadableErrorMessage } from "@/lib/errors";
import { useTransientErrorToast } from "./useTransientErrorToast";

// ── Types ──────────────────────────────────────────────────────

export interface LendingStats {
  /** Total value locked in XLM */
  tvl: number;
  /** 24-hour trading volume in XLM */
  volume24h: number;
  /** Number of currently active / open loans */
  activeLoans: number;
  /** Timestamp of when the stats were last updated (ISO string) */
  updatedAt: string | null;
}

export interface UseLendingStatsResult {
  stats: LendingStats | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

// ── Constants ──────────────────────────────────────────────────

const STATS_ENDPOINT = "/api/lending/stats";
/** Re-fetch interval in ms (30 s) */
const POLL_INTERVAL_MS = 30_000;

// ── Hook ───────────────────────────────────────────────────────

/**
 * Fetches platform-wide lending metrics (TVL, 24 h volume, active loans)
 * from the indexer's /api/lending/stats endpoint.
 *
 * - Handles loading and error states.
 * - Polls every 30 s to keep numbers fresh.
 * - Compatible with SWR-style usage: call `refresh()` to force an update.
 */
export function useLendingStats(): UseLendingStatsResult {
  const [stats, setStats] = useState<LendingStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useTransientErrorToast(error);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(STATS_ENDPOINT, {
        headers: { Accept: "application/json" },
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = await res.json();

      setStats({
        tvl: Number(data.tvl ?? 0),
        volume24h: Number(data.volume24h ?? 0),
        activeLoans: Number(data.activeLoans ?? 0),
        updatedAt: data.updatedAt ?? null,
      });
    } catch (err: unknown) {
      setError(
        getReadableErrorMessage(err, "Failed to load lending statistics"),
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial fetch + polling
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  return { stats, isLoading, error, refresh };
}
