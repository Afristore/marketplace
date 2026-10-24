// ─────────────────────────────────────────────────────────────
// hooks/mutations/useLiquidate.ts — Liquidate position hook
// ─────────────────────────────────────────────────────────────
//
// Feedback mirrors the other `hooks/mutations/*` hooks:
//   • failures surface through `useTransientErrorToast(error)`;
//   • success raises a `pushToast(…, "success")` showing the bounty.
//
// The toast accessor is the "safe" variant, so the hook keeps working
// when it is rendered outside a `ToastProvider` (unit tests, isolated
// widgets) instead of throwing and unmounting the tree. Every await
// sits inside a try/catch, so a rejected contract call can never escape
// as an unhandled promise rejection.
// ─────────────────────────────────────────────────────────────

"use client";

import { useState, useCallback } from "react";
import { liquidate } from "@/lib/lending";
import { getReadableErrorMessage } from "@/lib/errors";
import { useTransientErrorToast } from "../useTransientErrorToast";
import { useSafeToast } from "../useSafeToast";

export interface LiquidateParams {
  positionId: number | bigint;
  liquidatorPublicKey?: string;
}

export function useLiquidate(liquidatorPublicKey?: string | null) {
  const [isLiquidating, setIsLiquidating] = useState(false);
  const [bountyEarned, setBountyEarned] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  useTransientErrorToast(error);
  const pushToast = useSafeToast();

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

      if (positionId === undefined || positionId === null) {
        const msg = "Position ID is required";
        setError(msg);
        return null;
      }

      setIsLiquidating(true);
      setError(null);
      try {
        const result = await liquidate(activeKey, positionId);
        setBountyEarned(result.bountyEarned);

        const bountyDisplay = (Number(result.bountyEarned) / 1e7).toFixed(2);
        pushToast(
          `Position #${positionId} liquidated successfully! Bounty earned: ${bountyDisplay} USDC`,
          "success"
        );
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
