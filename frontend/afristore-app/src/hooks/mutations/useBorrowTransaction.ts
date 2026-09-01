// ─────────────────────────────────────────────────────────────
// hooks/mutations/useBorrowTransaction.ts — Borrow transaction hook
// ─────────────────────────────────────────────────────────────

"use client";

import { useState, useCallback } from "react";
import { borrow } from "@/lib/lending";
import { getReadableErrorMessage } from "@/lib/errors";
import { useTransientErrorToast } from "../useTransientErrorToast";

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
    [borrowerPublicKey]
  );

  return {
    borrow: executeBorrow,
    executeBorrow,
    isBorrowing,
    isLoading: isBorrowing,
    error,
  };
}
