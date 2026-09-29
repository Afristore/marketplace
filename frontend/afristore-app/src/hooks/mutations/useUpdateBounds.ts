// ─────────────────────────────────────────────────────────────
// hooks/mutations/useUpdateBounds.ts
// ─────────────────────────────────────────────────────────────
// Admin mutation to update the global collateral buffer and
// liquidation threshold bounds for the lending protocol. Bounds
// are validated locally (threshold must stay below the buffer)
// before anything is sent to the network.
// ─────────────────────────────────────────────────────────────

"use client";

import { useCallback, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { useTransientErrorToast } from "@/hooks/useTransientErrorToast";
import { getLendingAdmin, updateBounds } from "@/lib/lending";
import type { LendingBounds } from "@/lib/lending";

export type UpdateBoundsInput = LendingBounds;

export type BoundsValidation =
  | { valid: true }
  | { valid: false; error: string };

/**
 * Local validation of the global bounds before any transaction is built.
 *
 * Mirrors the protocol invariant: the liquidation threshold must always be
 * strictly lower than the collateral buffer, otherwise a position could be
 * liquidated while still fully collateralised. Each individual min/max pair
 * must also be ordered correctly.
 */
export function validateBounds(bounds: UpdateBoundsInput): BoundsValidation {
  const values = [
    bounds.minBufferBps,
    bounds.maxBufferBps,
    bounds.minLiqThresholdBps,
    bounds.maxLiqThresholdBps,
  ];

  for (const value of values) {
    if (!Number.isSafeInteger(value)) {
      return {
        valid: false,
        error: "All bounds must be whole basis-point values",
      };
    }
    if (value <= 0) {
      return { valid: false, error: "All bounds must be positive" };
    }
  }

  if (bounds.minBufferBps > bounds.maxBufferBps) {
    return {
      valid: false,
      error: "Minimum collateral buffer cannot exceed the maximum buffer",
    };
  }

  if (bounds.minLiqThresholdBps > bounds.maxLiqThresholdBps) {
    return {
      valid: false,
      error: "Minimum liquidation threshold cannot exceed the maximum threshold",
    };
  }

  // Sanity: every allowed threshold must be strictly below every allowed buffer.
  if (bounds.maxLiqThresholdBps >= bounds.minBufferBps) {
    return {
      valid: false,
      error: "Liquidation threshold must be lower than the collateral buffer",
    };
  }

  return { valid: true };
}

export function useUpdateBounds(adminPublicKey: string | null) {
  const { pushToast } = useToast();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useTransientErrorToast(error);

  const update = useCallback(
    async (bounds: UpdateBoundsInput): Promise<boolean> => {
      if (!adminPublicKey) {
        setError("Admin wallet not connected");
        return false;
      }

      const validation = validateBounds(bounds);
      if (!validation.valid) {
        setError(validation.error);
        return false;
      }

      setIsUpdating(true);
      setError(null);
      try {
        const configuredAdmin = await getLendingAdmin();
        if (configuredAdmin && configuredAdmin !== adminPublicKey) {
          setError("Only the protocol admin can update the global bounds");
          return false;
        }

        await updateBounds(adminPublicKey, bounds);
        pushToast("Protocol bounds updated", "success");
        return true;
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to update bounds");
        return false;
      } finally {
        setIsUpdating(false);
      }
    },
    [adminPublicKey, pushToast],
  );

  return { update, isUpdating, error };
}