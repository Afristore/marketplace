// ─────────────────────────────────────────────────────────────
// hooks/mutations/useReturnNFT.ts — Return NFT hook
// ─────────────────────────────────────────────────────────────
//
// Feedback mirrors the other `hooks/mutations/*` hooks:
//   • failures surface through `useTransientErrorToast(error)`;
//   • success raises a `pushToast(…, "success")`.
//
// The position id is validated locally and every await sits inside a
// try/catch, so a rejected contract call can never escape as an
// unhandled promise rejection.
// ─────────────────────────────────────────────────────────────

"use client";

import { useState, useCallback } from "react";
import { returnNFT } from "@/lib/lending";
import { getReadableErrorMessage } from "@/lib/errors";
import { useTransientErrorToast } from "../useTransientErrorToast";
import { useSafeToast } from "../useSafeToast";

export interface ReturnNFTParams {
  positionId: number | bigint;
  borrowerPublicKey?: string;
}

export function useReturnNFT(borrowerPublicKey?: string | null) {
  const [isReturningNFT, setIsReturningNFT] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useTransientErrorToast(error);
  const pushToast = useSafeToast();

  const executeReturnNFT = useCallback(
    async (
      positionIdOrParams: number | bigint | ReturnNFTParams
    ): Promise<boolean> => {
      let positionId: number | bigint;
      let activeKey = borrowerPublicKey;

      if (
        typeof positionIdOrParams === "object" &&
        positionIdOrParams !== null
      ) {
        positionId = positionIdOrParams.positionId;
        if (positionIdOrParams.borrowerPublicKey) {
          activeKey = positionIdOrParams.borrowerPublicKey;
        }
      } else {
        positionId = positionIdOrParams;
      }

      if (!activeKey) {
        const msg = "Wallet not connected";
        setError(msg);
        return false;
      }

      if (positionId === undefined || positionId === null) {
        const msg = "Position ID is required";
        setError(msg);
        return false;
      }

      setIsReturningNFT(true);
      setError(null);
      try {
        await returnNFT(activeKey, positionId);
        pushToast(`Position #${positionId} repaid successfully`, "success");
        return true;
      } catch (err: unknown) {
        const msg = getReadableErrorMessage(err, "Failed to return NFT");
        setError(msg);
        return false;
      } finally {
        setIsReturningNFT(false);
      }
    },
    [borrowerPublicKey, pushToast]
  );

  return {
    returnNFT: executeReturnNFT,
    executeReturnNFT,
    isReturningNFT,
    isLoading: isReturningNFT,
    error,
  };
}
