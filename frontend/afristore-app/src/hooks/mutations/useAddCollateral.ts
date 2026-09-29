// ─────────────────────────────────────────────────────────────
// hooks/mutations/useAddCollateral.ts — Add collateral hook
// ─────────────────────────────────────────────────────────────

"use client";

import { useState, useCallback } from "react";
import { addCollateral } from "@/lib/lending";
import { getReadableErrorMessage } from "@/lib/errors";
import { useTransientErrorToast } from "../useTransientErrorToast";

export interface AddCollateralParams {
  positionId: number | bigint;
  amount: bigint | number | string;
  collateralCurrency?: string;
  borrowerPublicKey?: string;
}

export function useAddCollateral(borrowerPublicKey?: string | null) {
  const [isAddingCollateral, setIsAddingCollateral] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useTransientErrorToast(error);

  const executeAddCollateral = useCallback(
    async (params: AddCollateralParams): Promise<boolean> => {
      const activeKey = params.borrowerPublicKey ?? borrowerPublicKey;
      if (!activeKey) {
        const msg = "Wallet not connected";
        setError(msg);
        return false;
      }

      if (!params.positionId && params.positionId !== 0) {
        const msg = "Position ID is required";
        setError(msg);
        return false;
      }

      if (!params.amount || BigInt(params.amount) <= 0n) {
        const msg = "Amount must be greater than zero";
        setError(msg);
        return false;
      }

      setIsAddingCollateral(true);
      setError(null);
      try {
        await addCollateral(
          activeKey,
          params.positionId,
          params.amount,
          params.collateralCurrency
        );
        return true;
      } catch (err: unknown) {
        const msg = getReadableErrorMessage(
          err,
          "Failed to add collateral"
        );
        setError(msg);
        return false;
      } finally {
        setIsAddingCollateral(false);
      }
    },
    [borrowerPublicKey]
  );

  return {
    addCollateral: executeAddCollateral,
    executeAddCollateral,
    isAddingCollateral,
    isLoading: isAddingCollateral,
    error,
  };
}
