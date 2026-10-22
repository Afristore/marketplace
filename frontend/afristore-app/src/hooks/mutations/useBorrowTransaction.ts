// ─────────────────────────────────────────────────────────────
// hooks/mutations/useBorrowTransaction.ts — Borrow transaction hook
// ─────────────────────────────────────────────────────────────
//
// Feedback mirrors the other `hooks/mutations/*` hooks:
//   • failures surface through `useTransientErrorToast(error)`,
//     which raises an error toast with a readable message;
//   • success raises a `pushToast(…, "success")`.
//
// Every step is awaited inside a try/catch so a rejected contract
// call can never escape as an unhandled promise rejection.
// ─────────────────────────────────────────────────────────────

"use client";

import { useState, useCallback } from "react";
import { borrow } from "@/lib/lending";
import { getReadableErrorMessage } from "@/lib/errors";
import { useTransientErrorToast } from "../useTransientErrorToast";
import { useSafeToast } from "../useSafeToast";

export interface BorrowTransactionParams {
  listingId: number | bigint;
  collateralCurrency: string;
  collateralAmount: bigint | number | string;
  borrowerPublicKey?: string;
}

export function useBorrowTransaction(borrowerPublicKey?: string | null) {
  const [isBorrowing, setIsBorrowing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useTransientErrorToast(error);
  const pushToast = useSafeToast();

  const executeBorrow = useCallback(
    async (params: BorrowTransactionParams): Promise<number | null> => {
      const activeKey = params.borrowerPublicKey ?? borrowerPublicKey;
      if (!activeKey) {
        const msg = "Wallet not connected";
        setError(msg);
        return null;
      }

      setIsBorrowing(true);
      setError(null);
      try {
        const positionId = await borrow(
          activeKey,
          params.listingId,
          params.collateralCurrency,
          params.collateralAmount
        );
        pushToast(`Position #${positionId} borrowed successfully`, "success");
        return positionId;
      } catch (err: unknown) {
        const msg = getReadableErrorMessage(
          err,
          "Failed to execute borrow transaction"
        );
        setError(msg);
        return null;
      } finally {
        setIsBorrowing(false);
      }
    },
    [borrowerPublicKey, pushToast]
  );

  return {
    borrow: executeBorrow,
    executeBorrow,
    isBorrowing,
    isLoading: isBorrowing,
    error,
  };
}
