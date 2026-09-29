// ─────────────────────────────────────────────────────────────
// hooks/mutations/useCancelListing.ts — Cancel listing transaction hook
// ─────────────────────────────────────────────────────────────
// Artist mutation that cancels one of their active on-chain
// listings. The hook accepts only the listing id — nothing else.
//
// The transaction is built, simulated and submitted inside
// `cancelListing` → `invokeContract` (src/lib/contract.ts): the
// invocation is simulated with `rpc.simulateTransaction`, the
// simulation result is folded back into the transaction via
// `SorobanRpc.assembleTransaction` (resource fees, footprint and
// Soroban auth) before it is handed to Freighter for signing and
// only then submitted and polled to a terminal ledger status.
// Signing happens entirely in the user's wallet — no secret key
// is ever seen here.
//
// Feedback mirrors `hooks/mutations/useCreateListing.ts`:
//   • failures surface through `useTransientErrorToast(error)`;
//     contract rejections (not your listing, already cancelled,
//     already sold, listing not found…) are mapped to a readable
//     message by `getReadableErrorMessage` before they get there.
//   • success raises a `pushToast(…, "success")`
//   • a signature the user declines in their wallet is a normal
//     action, not a failure — it clears quietly with an "info"
//     toast and never sets the error state.
// ─────────────────────────────────────────────────────────────

"use client";

import { useCallback, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { useTransientErrorToast } from "@/hooks/useTransientErrorToast";
import { cancelListing } from "@/lib/contract";
import { getReadableErrorMessage } from "@/lib/errors";

/**
 * Returns true when an error thrown out of the sign step is the user
 * declining the signature in their wallet (Freighter's own message is
 * "User declined access"; the e2e mock chain throws the same string).
 * A declined signature is a normal user action, so callers treat it
 * differently from a real failure.
 */
function isUserRejectedSignature(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /user declined|declined access|user rejected|request was rejected|denied by the user/i.test(
    message,
  );
}

export function useCancelListing(artistPublicKey: string | null) {
  const { pushToast } = useToast();
  const [isCancelling, setIsCancelling] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  useTransientErrorToast(error);

  const cancel = useCallback(
    async (listingId: number): Promise<boolean> => {
      if (!artistPublicKey) {
        setError("Wallet not connected");
        return false;
      }

      setIsCancelling(true);
      setError(null);

      try {
        // Build → simulate → sign → submit → confirm, all inside
        // cancelListing → invokeContract.
        setProgress("Cancelling on-chain listing…");
        await cancelListing(artistPublicKey, listingId);

        setProgress("Listing cancelled successfully!");
        pushToast(`Listing #${listingId} cancelled`, "success");
        return true;
      } catch (err: unknown) {
        // A declined wallet signature is not a failure to shout about.
        if (isUserRejectedSignature(err)) {
          setProgress("");
          pushToast("Listing cancellation dismissed.", "info");
          return false;
        }
        setError(getReadableErrorMessage(err, "Failed to cancel listing"));
        return false;
      } finally {
        setIsCancelling(false);
      }
    },
    [artistPublicKey, pushToast],
  );

  return { cancel, isCancelling, progress, error };
}
