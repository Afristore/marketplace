// ─────────────────────────────────────────────────────────────
// hooks/mutations/useSetFees.ts
// ─────────────────────────────────────────────────────────────
// Admin mutation for the lending protocol's platform and
// liquidator fees (`admin_set_fees`). Fees are validated with
// `feesSchema` first: each 0–10000 bps and, together, strictly
// below 10000 bps, matching the contract's `validate_fees`.
// ─────────────────────────────────────────────────────────────

"use client";

import { useCallback, useState } from "react";
import { useSafeToast } from "@/hooks/useSafeToast";
import { useTransientErrorToast } from "@/hooks/useTransientErrorToast";
import { getLendingAdmin, setFees } from "@/lib/lending";
import { getReadableErrorMessage } from "@/lib/errors";
import { feesSchema, type FeesFormValues } from "@/lib/lendingValidation";

export function useSetFees(adminPublicKey: string | null) {
  const pushToast = useSafeToast();
  const [isSettingFees, setIsSettingFees] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useTransientErrorToast(error);

  const saveFees = useCallback(
    async (values: FeesFormValues): Promise<boolean> => {
      if (!adminPublicKey) {
        setError("Admin wallet not connected");
        return false;
      }

      const parsed = feesSchema.safeParse(values);
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? "Invalid fees");
        return false;
      }

      setIsSettingFees(true);
      setError(null);
      try {
        const configuredAdmin = await getLendingAdmin();
        if (configuredAdmin && configuredAdmin !== adminPublicKey) {
          setError("Only the protocol admin can update the fees");
          return false;
        }

        await setFees(
          adminPublicKey,
          Number(parsed.data.platformFeeBps),
          Number(parsed.data.liquidatorFeeBps),
        );
        pushToast("Protocol fees updated", "success");
        return true;
      } catch (err: unknown) {
        setError(getReadableErrorMessage(err, "Failed to update fees"));
        return false;
      } finally {
        setIsSettingFees(false);
      }
    },
    [adminPublicKey, pushToast],
  );

  return { saveFees, isSettingFees, error };
}
