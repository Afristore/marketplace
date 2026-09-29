// ─────────────────────────────────────────────────────────────
// hooks/mutations/useWhitelistCurrency.ts
// ─────────────────────────────────────────────────────────────
// Admin mutation to whitelist a new collateral currency for the
// lending protocol. Admin-only: the transaction is only simulated
// and submitted when the connected wallet matches the protocol
// admin, mirroring the on-chain auth guard.
// ─────────────────────────────────────────────────────────────

"use client";

import { useCallback, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { useTransientErrorToast } from "@/hooks/useTransientErrorToast";
import { getLendingAdmin, whitelistCurrency } from "@/lib/lending";

export function useWhitelistCurrency(adminPublicKey: string | null) {
  const { pushToast } = useToast();
  const [isWhitelisting, setIsWhitelisting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useTransientErrorToast(error);

  const whitelist = useCallback(
    async (currencyAddress: string, symbol?: string): Promise<boolean> => {
      if (!adminPublicKey) {
        setError("Admin wallet not connected");
        return false;
      }
      if (!currencyAddress) {
        setError("A valid collateral currency address is required");
        return false;
      }

      setIsWhitelisting(true);
      setError(null);
      try {
        const configuredAdmin = await getLendingAdmin();
        if (configuredAdmin && configuredAdmin !== adminPublicKey) {
          setError("Only the protocol admin can whitelist collateral currencies");
          return false;
        }

        await whitelistCurrency(adminPublicKey, currencyAddress, symbol ?? currencyAddress);
        pushToast("Collateral currency whitelisted", "success");
        return true;
      } catch (err: unknown) {
        setError(
          err instanceof Error ? err.message : "Failed to whitelist currency",
        );
        return false;
      } finally {
        setIsWhitelisting(false);
      }
    },
    [adminPublicKey, pushToast],
  );

  return { whitelist, isWhitelisting, error };
}