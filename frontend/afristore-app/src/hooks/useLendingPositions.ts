"use client";

import { useCallback, useEffect, useState } from "react";
import { config } from "@/lib/config";

/** JSON returned by the indexer's borrower and lender position endpoints. */
export interface IndexedLendingPosition {
  positionId: string;
  listingId: string;
  nftContract: string;
  tokenId: string;
  declaredPriceUsd: string;
  collateralCurrency: string;
  interestScheduleBps: number[];
  liquidationThresholdBps: number;
  startTime: string;
  status: "Active" | "Returned" | "Liquidated" | "Expired";
  healthFactor: string | null;
}

export function useLendingPositions(
  walletAddress: string | null,
  role: "borrower" | "lender",
) {
  const [result, setResult] = useState<{
    wallet: string | null;
    positions: IndexedLendingPosition[];
    loading: boolean;
    error: string | null;
  }>({ wallet: null, positions: [], loading: true, error: null });
  const [revision, setRevision] = useState(0);
  const refetch = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!walletAddress) return;
    const controller = new AbortController();
    setResult({
      wallet: walletAddress,
      positions: [],
      loading: true,
      error: null,
    });
    const path = role === "lender" ? "positions/lender" : "positions";

    async function load() {
      try {
        const response = await fetch(
          `${config.indexerUrl}/api/lending/${path}/${encodeURIComponent(walletAddress!)}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (!response.ok)
          throw new Error(
            `Failed to fetch ${role} positions (HTTP ${response.status})`,
          );
        const data: (
          IndexedLendingPosition | { position: IndexedLendingPosition }
        )[] = await response.json();
        const positions = data.map((row) =>
          "position" in row ? row.position : row,
        );
        if (!controller.signal.aborted) {
          setResult({
            wallet: walletAddress,
            positions,
            loading: false,
            error: null,
          });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setResult({
            wallet: walletAddress,
            positions: [],
            loading: false,
            error:
              error instanceof Error
                ? error.message
                : "Failed to fetch positions",
          });
        }
      }
    }
    void load();
    return () => controller.abort();
  }, [walletAddress, role, revision]);

  // Never display positions from a previous wallet while the next request starts.
  if (!walletAddress || result.wallet !== walletAddress) {
    return { positions: [], loading: !!walletAddress, error: null, refetch };
  }
  return { ...result, refetch };
}
