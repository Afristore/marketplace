// ─────────────────────────────────────────────────────────────
// components/lending/format.ts — Display formatters for the
// lending & borrowing UI.
//
// Monetary amounts are 7-decimal fixed-point integers
// (1 USD = 10_000_000). Rates use basis points (bps).
//──────────────────────────────────────────────────────────────

import { toBigInt } from "@/lib/lendingMath";

/** Fixed-point scale used by the lending contracts: 1 USD = 1e7. */
const USD_DECIMALS = 10_000_000n;

/**
 * Formats a 7-decimal fixed-point USD amount as "$1,234.50".
 * Negative amounts render with a leading minus sign.
 */
export function formatUsd(value: bigint | number | string): string {
  const v = toBigInt(value, "value");
  const sign = v < 0n ? "-" : "";
  const abs = v < 0n ? -v : v;
  const whole = abs / USD_DECIMALS;
  const cents = (abs % USD_DECIMALS) / 100_000n;
  const wholeStr = Intl.NumberFormat("en-US").format(whole);
  const centsStr = cents.toString().padStart(2, "0");
  return `$${sign}${wholeStr}.${centsStr}`;
}

/**
 * Formats a raw token amount (smallest units) into human-readable
 * units for the token's decimal scale, trimming trailing zeros.
 */
export function formatTokenAmount(
  amount: bigint | number | string,
  decimals: number,
): string {
  const raw = toBigInt(amount, "amount");
  if (raw === 0n) return "0";
  if (!Number.isFinite(decimals) || decimals <= 0) return raw.toString();

  const factor = 10n ** BigInt(decimals);
  const whole = raw / factor;
  const frac = raw % factor;
  if (frac === 0n) return whole.toString();

  const fracStr = frac
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

/** Formats a duration in days, e.g. 30 -> "30 days", 1 -> "1 day". */
export function formatDurationDays(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return "Flexible";
  return `${days} ${days === 1 ? "day" : "days"}`;
}

/** Converts basis points to an exact percentage label, e.g. 500 -> "5.00%". */
export function formatBpsPercent(bps: number | bigint): string {
  return `${(Number(bps) / 100).toFixed(2)}%`;
}