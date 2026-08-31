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
}
