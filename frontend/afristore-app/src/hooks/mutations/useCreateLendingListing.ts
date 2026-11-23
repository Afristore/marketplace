// ─────────────────────────────────────────────────────────────
// hooks/mutations/useCreateLendingListing.ts
// ─────────────────────────────────────────────────────────────
// Lender mutation that escrows an NFT in the lending contract and
// opens a lending listing (`create_listing`).
//
// Flow:
//   1. Validate the terms locally against every check the contract
//      panics on, including the platform's buffer/threshold bounds
//      when `get_config` is readable.
//   2. Pre-flight the NFT transfer (#1270): `create_listing` moves the
//      NFT with `transfer(lender, contract, id)`, so it fails on-chain
//      unless the lender owns the token. We read `owner_of` first and
//      stop with a clear message if the lender is not the owner.
//      No separate approval is needed: `transfer` checks the lender's
//      own auth, which their signature on this transaction provides.
//   3. Build → simulate → sign → submit → confirm via
//      `createLendingListing` → `invokeContract`.
//
// Feedback mirrors the other mutation hooks: errors go through
// `useTransientErrorToast`, success raises a success toast, and a
// declined wallet signature clears quietly with an info toast.
// ─────────────────────────────────────────────────────────────

"use client";

import { useCallback, useState } from "react";
import { useSafeToast } from "@/hooks/useSafeToast";
import { useTransientErrorToast } from "@/hooks/useTransientErrorToast";
import {
  createLendingListing,
  getLendingContractId,
  getLendingPlatformConfig,
  getNftOwner,
} from "@/lib/lending";
import { getReadableErrorMessage } from "@/lib/errors";
import {
  validateLendingListing,
  type CreateLendingListingInput,
} from "@/lib/lendingValidation";

export type { CreateLendingListingInput };

function isUserRejectedSignature(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /user declined|declined access|user rejected|request was rejected|denied by the user/i.test(
    message,
  );
}

/**
 * Checks the lending contract will be able to move the NFT. Returns an error
 * message, or null when the lender owns the token.
 */
export async function checkNftTransferable(
  lenderPublicKey: string,
  nftContract: string,
  tokenId: number | bigint,
): Promise<string | null> {
  const owner = await getNftOwner(lenderPublicKey, nftContract, tokenId);
  if (owner === null) {
    return "Could not find this NFT on-chain. Check the collection and token id.";
  }
  if (owner === getLendingContractId()) {
    return "This NFT is already escrowed in a lending listing.";
  }
  if (owner !== lenderPublicKey) {
    return "This NFT is not in your connected wallet, so it cannot be listed for lending.";
  }
  return null;
}

export function useCreateLendingListing(lenderPublicKey: string | null) {
  const pushToast = useSafeToast();
  const [isCreating, setIsCreating] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  useTransientErrorToast(error);

  const create = useCallback(
    async (input: CreateLendingListingInput): Promise<number | null> => {
      if (!lenderPublicKey) {
        setError("Wallet not connected");
        return null;
      }

      setIsCreating(true);
      setError(null);

      try {
        setProgress("Checking listing terms…");
        const platform = await getLendingPlatformConfig();
        const validation = validateLendingListing(
          input,
          platform && {
            minBufferBps: platform.min_buffer_bps,
            maxBufferBps: platform.max_buffer_bps,
            minLiqThresholdBps: platform.min_liq_threshold_bps,
            maxLiqThresholdBps: platform.max_liq_threshold_bps,
          },
        );
        if (!validation.valid) {
          setProgress("");
          setError(validation.error);
          return null;
        }

        setProgress("Checking the NFT can be escrowed…");
        const transferProblem = await checkNftTransferable(
          lenderPublicKey,
          input.nftContract,
          input.tokenId,
        );
        if (transferProblem) {
          setProgress("");
          setError(transferProblem);
          return null;
        }

        setProgress("Creating lending listing on-chain…");
        const listingId = await createLendingListing(lenderPublicKey, input);

        setProgress("Lending listing created!");
        pushToast(`Lending listing #${listingId} created`, "success");
        return listingId;
      } catch (err: unknown) {
        if (isUserRejectedSignature(err)) {
          setProgress("");
          pushToast("Lending listing dismissed.", "info");
          return null;
        }
        setProgress("");
        setError(getReadableErrorMessage(err, "Failed to create lending listing"));
        return null;
      } finally {
        setIsCreating(false);
      }
    },
    [lenderPublicKey, pushToast],
  );

  return { create, isCreating, progress, error };
}
