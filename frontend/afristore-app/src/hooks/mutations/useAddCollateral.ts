// ─────────────────────────────────────────────────────────────
// hooks/mutations/useAddCollateral.ts — Add collateral hook
// ─────────────────────────────────────────────────────────────
//
// Feedback mirrors the other `hooks/mutations/*` hooks:
//   • failures surface through `useTransientErrorToast(error)`;
//   • success raises a `pushToast(…, "success")`.
//
// The amount is validated locally before the transaction is built and
// every await sits inside a try/catch, so a rejected contract call can
// never escape as an unhandled promise rejection.
// ─────────────────────────────────────────────────────────────

"use client";

import { useState, useCallback } from "react";
import { addCollateral } from "@/lib/lending";
import { getReadableErrorMessage } from "@/lib/errors";
import { useTransientErrorToast } from "../useTransientErrorToast";
import { useSafeToast } from "../useSafeToast";

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
  const pushToast = useSafeToast();

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

      if (params.amount === undefined || params.amount === null || params.amount === "") {
        const msg = "Amount must be greater than zero";
        setError(msg);
        return false;
      }

      // `BigInt` throws on a non-numeric amount — convert defensively so
      // a bad input surfaces as a readable error instead of a rejection.
      let amount: bigint;
      try {
        amount = BigInt(params.amount);
      } catch {
        const msg = "Amount must be a valid number";
        setError(msg);
        return false;
      }

      if (amount <= 0n) {
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
          amount,
          params.collateralCurrency
        );
        pushToast(
          `Collateral added to position #${params.positionId}`,
          "success"
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
    [borrowerPublicKey, pushToast]
  );

  return {
    addCollateral: executeAddCollateral,
    executeAddCollateral,
    isAddingCollateral,
    isLoading: isAddingCollateral,
    error,
  };
}
