// ─────────────────────────────────────────────────────────────
// lib/lendingValidation.ts — Pure Zod schemas for lending forms
// ─────────────────────────────────────────────────────────────
// Kept free of network code so the rules can be unit-tested and
// shared between modals and mutation hooks.
// ─────────────────────────────────────────────────────────────

import { z } from "zod";

/** 100% in basis points. */
export const BPS_DENOMINATOR = 10_000;

/** Lending amounts are 7-decimal fixed point (matches the contract). */
export const AMOUNT_DECIMALS = 7;

const wholeBps = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .regex(/^\d+$/, `${label} must be a whole number of bps`)
    .refine((v) => Number(v) <= BPS_DENOMINATOR, `${label} cannot exceed 10000 bps (100%)`);

/**
 * Platform + liquidator fee form (admin_set_fees). Each fee is 0–10000 bps,
 * and together they must stay strictly below 100%, mirroring the contract's
 * `validate_fees` ("combined fees must be less than 10000").
 */
export const feesSchema = z
  .object({
    platformFeeBps: wholeBps("Platform fee"),
    liquidatorFeeBps: wholeBps("Liquidator fee"),
  })
  .refine((v) => Number(v.platformFeeBps) + Number(v.liquidatorFeeBps) < BPS_DENOMINATOR, {
    message: "Platform and liquidator fees together must be less than 10000 bps (100%)",
    path: ["liquidatorFeeBps"],
  });

export type FeesFormValues = z.input<typeof feesSchema>;

/**
 * Parses a decimal string into 7-decimal fixed point without going through a
 * float. Returns null for anything that is not a plain non-negative decimal or
 * has more than 7 fraction digits.
 */
export function parseFixed7(input: string): bigint | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(input.trim());
  if (!match) return null;
  const [, whole, fraction = ""] = match;
  if (fraction.length > AMOUNT_DECIMALS) return null;
  return BigInt(whole) * 10n ** BigInt(AMOUNT_DECIMALS) + BigInt(fraction.padEnd(AMOUNT_DECIMALS, "0"));
}

/** Formats a 7-decimal fixed-point amount for messages, trimming zeros. */
export function formatFixed7(value: bigint): string {
  const base = 10n ** BigInt(AMOUNT_DECIMALS);
  const whole = value / base;
  const fraction = (value % base).toString().padStart(AMOUNT_DECIMALS, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/**
 * Collateral top-up amount. Must be a positive decimal with at most 7
 * fraction digits, and — when the wallet balance is known — no more than the
 * borrower holds, so the transaction cannot revert on-chain and waste fees.
 */
export function topUpAmountSchema(walletBalance: bigint | null) {
  return z
    .string()
    .trim()
    .min(1, "Enter an amount greater than zero")
    .refine((v) => parseFixed7(v) !== null, "Enter a valid amount with at most 7 decimal places")
    .refine((v) => (parseFixed7(v) ?? 0n) > 0n, "Enter an amount greater than zero")
    .refine(
      (v) => walletBalance === null || (parseFixed7(v) ?? 0n) <= walletBalance,
      walletBalance === null
        ? "Insufficient balance"
        : `Insufficient balance: your wallet holds ${formatFixed7(walletBalance)}`,
    );
}

/** Input for the lending contract's `create_listing`. */
export interface CreateLendingListingInput {
  nftContract: string;
  tokenId: number | bigint;
  /** 7-decimal fixed-point USD. */
  declaredPriceUsd: bigint;
  interestScheduleBps: number[];
  maxDurationDays: number;
  minCollateralBufferBps: number;
  liquidationThresholdBps: number;
}

/** Platform bounds a listing must fall within (from `get_config`). */
export interface ListingBounds {
  minBufferBps: number;
  maxBufferBps: number;
  minLiqThresholdBps: number;
  maxLiqThresholdBps: number;
}

const U64_MAX = 18_446_744_073_709_551_615n;

/**
 * Mirrors every check `create_listing` panics on, so a bad listing fails here
 * with a clear message instead of on-chain. `bounds` is optional because the
 * platform config may not be readable; the contract still enforces it.
 */
export function validateLendingListing(
  input: CreateLendingListingInput,
  bounds?: ListingBounds | null,
): { valid: true } | { valid: false; error: string } {
  const fail = (error: string) => ({ valid: false as const, error });
  if (!input.nftContract) return fail("Choose the NFT collection to list");
  const tokenId = BigInt(input.tokenId);
  if (tokenId < 0n || tokenId > U64_MAX) return fail("Token id is out of range");
  if (input.declaredPriceUsd <= 0n) return fail("Declared price must be greater than zero");
  if (input.interestScheduleBps.length === 0) return fail("Add at least one monthly interest rate");
  if (input.interestScheduleBps.some((r) => !Number.isInteger(r) || r <= 0 || r > BPS_DENOMINATOR)) {
    return fail("Each interest rate must be a whole number of bps between 1 and 10000");
  }
  if (!Number.isInteger(input.maxDurationDays) || input.maxDurationDays <= 0) {
    return fail("Max loan duration must be at least one day");
  }
  if (bounds) {
    if (
      input.minCollateralBufferBps < bounds.minBufferBps ||
      input.minCollateralBufferBps > bounds.maxBufferBps
    ) {
      return fail(
        `Collateral buffer must be between ${bounds.minBufferBps} and ${bounds.maxBufferBps} bps`,
      );
    }
    if (
      input.liquidationThresholdBps < bounds.minLiqThresholdBps ||
      input.liquidationThresholdBps > bounds.maxLiqThresholdBps
    ) {
      return fail(
        `Liquidation threshold must be between ${bounds.minLiqThresholdBps} and ${bounds.maxLiqThresholdBps} bps`,
      );
    }
  }
  return { valid: true };
}
