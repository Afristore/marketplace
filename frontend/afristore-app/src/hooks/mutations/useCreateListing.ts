// ─────────────────────────────────────────────────────────────
// hooks/mutations/useCreateListing.ts — Create listing transaction hook
// ─────────────────────────────────────────────────────────────
// Artist mutation that lists an owned NFT on the marketplace.
//
// The transaction is built, simulated and submitted inside
// `createListing` → `invokeContract` (src/lib/contract.ts): the
// invocation is simulated with `rpc.simulateTransaction`, the
// simulation result is folded back into the transaction via
// `SorobanRpc.assembleTransaction` (resource fees, footprint and
// Soroban auth) before it is handed to Freighter for signing and
// only then submitted and polled to a terminal ledger status.
// Signing happens entirely in the user's wallet — no secret key
// is ever seen here.
//
// Feedback mirrors the other `hooks/mutations/*` hooks:
//   • failures surface through `useTransientErrorToast(error)`
//   • success raises a `pushToast(…, "success")`
//   • a signature the user declines in their wallet is a normal
//     action, not a failure — it clears quietly with an "info"
//     toast and never sets the error state.
// ─────────────────────────────────────────────────────────────

"use client";

import { useCallback, useState } from "react";
import { useToast } from "@/components/ToastProvider";
import { useTransientErrorToast } from "@/hooks/useTransientErrorToast";
import { createListing } from "@/lib/contract";
import { getReadableErrorMessage } from "@/lib/errors";
import { assertSupportedTokenAddress } from "@/lib/token-support";
import { trackEvent } from "@/providers/PostHogProvider";

export interface CreateListingInput {
  collectionAddress: string;
  nftTokenId: number;
  price: number;
  amount?: number;
  tokenAddress?: string;
}

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

export function useCreateListing(artistPublicKey: string | null) {
  const { pushToast } = useToast();
  const [isCreating, setIsCreating] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  useTransientErrorToast(error);

  const create = useCallback(
    async (input: CreateListingInput): Promise<number | null> => {
      if (!artistPublicKey) {
        setError("Wallet not connected");
        return null;
      }

      setIsCreating(true);
      setError(null);

      try {
        setProgress("Validating payment token…");
        const token = await assertSupportedTokenAddress(
          input.tokenAddress,
          "listing",
        );

        // Build → simulate → sign → submit → confirm, all inside
        // createListing → invokeContract.
        setProgress("Creating on-chain listing…");
        const listingId = await createListing(
          artistPublicKey,
          input.price,
          token.address,
          input.collectionAddress,
          input.nftTokenId,
        );

        trackEvent.listingCreated(
          listingId,
          input.price.toString(),
          token.symbol || "XLM",
        );

        setProgress("Listing created successfully!");
        pushToast(`Listing #${listingId} created`, "success");
        return listingId;
      } catch (err: unknown) {
        // A declined wallet signature is not a failure to shout about.
        if (isUserRejectedSignature(err)) {
          setProgress("");
          pushToast("Listing creation cancelled.", "info");
          return null;
        }
        setError(getReadableErrorMessage(err, "Failed to create listing"));
        return null;
      } finally {
        setIsCreating(false);
      }
    },
    [artistPublicKey, pushToast],
  );

  return { create, isCreating, progress, error };
}
