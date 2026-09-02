// ─────────────────────────────────────────────────────────────
// hooks/mutations/useLiquidate.ts — Liquidate position hook
// ─────────────────────────────────────────────────────────────

"use client";

import { useState, useCallback } from "react";
import { liquidate } from "@/lib/lending";
import { getReadableErrorMessage } from "@/lib/errors";
import { useToast } from "@/components/ToastProvider";
import { useTransientErrorToast } from "../useTransientErrorToast";

export interface LiquidateParams {
  positionId: number | bigint;
  liquidatorPublicKey?: string;
}

export function useLiquidate(liquidatorPublicKey?: string | null) {
  const [isLiquidating, setIsLiquidating] = useState(false);
  const [bountyEarned, setBountyEarned] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  useTransientErrorToast(error);

  let pushToast:
    | ((message: string, type?: "error" | "success" | "info") => void)
    | null = null;
  try {
    const toastContext = useToast();
    pushToast = toastContext.pushToast;
  } catch {
    // Fallback when executed outside ToastProvider (e.g., in unit tests)
  }

  const executeLiquidate = useCallback(
    async (
      positionIdOrParams: number | bigint | LiquidateParams
    ): Promise<bigint | null> => {
      let positionId: number | bigint;
      let activeKey = liquidatorPublicKey;

      if (
        typeof positionIdOrParams === "object" &&
        positionIdOrParams !== null
      ) {
        positionId = positionIdOrParams.positionId;
        if (positionIdOrParams.liquidatorPublicKey) {
          activeKey = positionIdOrParams.liquidatorPublicKey;
        }
      } else {
        positionId = positionIdOrParams;
      }

      if (!activeKey) {
        const msg = "Wallet not connected";
        setError(msg);
        return null;
      }

      setIsLiquidating(true);
      setError(null);
      try {
        const result = await liquidate(activeKey, positionId);
        setBountyEarned(result.bountyEarned);

        const bountyDisplay = (Number(result.bountyEarned) / 1e7).toFixed(2);
        const successMsg = `Position #${positionId} liquidated successfully! Bounty earned: ${bountyDisplay} USDC`;
        if (pushToast) {
          pushToast(successMsg, "success");
        }
        return result.bountyEarned;
      } catch (err: unknown) {
        const msg = getReadableErrorMessage(err, "Failed to liquidate position");
        setError(msg);
        return null;
      } finally {
        setIsLiquidating(false);
      }
    },
    [liquidatorPublicKey, pushToast]
  );

  return {
    liquidate: executeLiquidate,
    executeLiquidate,
    isLiquidating,
    isLoading: isLiquidating,
    bountyEarned,
    error,
  };
}
