// ─────────────────────────────────────────────────────────────
// hooks/mutations/useReturnNFT.ts — Return NFT hook
// ─────────────────────────────────────────────────────────────

"use client";

import { useState, useCallback } from "react";
import { returnNFT } from "@/lib/lending";
import { getReadableErrorMessage } from "@/lib/errors";
import { useTransientErrorToast } from "../useTransientErrorToast";

export interface ReturnNFTParams {
  positionId: number | bigint;
  borrowerPublicKey?: string;
}

export function useReturnNFT(borrowerPublicKey?: string | null) {
  const [isReturningNFT, setIsReturningNFT] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useTransientErrorToast(error);

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

      setIsReturningNFT(true);
      setError(null);
      try {
        await returnNFT(activeKey, positionId);
        return true;
      } catch (err: unknown) {
        const msg = getReadableErrorMessage(err, "Failed to return NFT");
        setError(msg);
        return false;
      } finally {
        setIsReturningNFT(false);
      }
    },
    [borrowerPublicKey]
  );

  return {
    returnNFT: executeReturnNFT,
    executeReturnNFT,
    isReturningNFT,
    isLoading: isReturningNFT,
    error,
  };
}
