// ─────────────────────────────────────────────────────────────
// lib/lendingMath.ts — Exact port of the Lending contract math
//
// Replicates contracts/lending/src/interest.rs (accrual) and the
// health-factor formula documented in contracts/lending/README.md
// so the UI previews match on-chain results exactly.
//
// All monetary inputs are 7-decimal fixed-point integers
// (1 USD = 10_000_000). All rates are basis points (bps).
// Integer (BigInt) division mirrors the contract's i128 arithmetic.
// ─────────────────────────────────────────────────────────────

/** Fixed-point scale used across the contract: 1 USD = 1e7. */
export const USD_DECIMALS = 10_000_000n;

/** Health factor is expressed in basis points (1.0 = 10000 bps). */
export const HEALTH_FACTOR_SCALE = 10_000n;

/**
 * Sentinel returned when a position carries no debt, since the contract
 * would otherwise divide by zero. Represents "infinitely healthy".
 */
export const MAX_HEALTH_FACTOR_BPS = 1_000_000_000_000n;

/**
 * Default declared price used when `calculateAccruedInterest` is called
 * without one — 7-decimal fixed-point USD 100, matching the contract's own
 * reference test vectors.
 */
export const DEFAULT_DECLARED_PRICE_USD = 100_000_000n;

/**
 * Coerces a value to bigint. Accepts bigint, whole numbers, and integer
 * strings (optionally with a trailing `.0..` suffix).
 */
export function toBigInt(
  value: bigint | number | string,
  label = "value",
): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(`${label} must be a whole number`);
    }
    return BigInt(value);
  }
  if (typeof value === "string") {
    const match = /^(-?\d+)(?:\.0+)?$/.exec(value.trim());
    if (!match) {
      throw new TypeError(`${label} must be an integer (or "int.0..") string`);
    }
    return BigInt(match[1]);
  }
  throw new TypeError(`${label} must be a bigint, number, or integer string`);
}

/**
 * Accrued interest in USD (7-decimal fixed-point) for a position, given the
 * per-month interest schedule and the number of completed months elapsed.
 *
 * Replicates `accrued_interest_usd` from contracts/lending/src/interest.rs
 * for whole months (partial-day pro-rating is not modelled; elapsedMonths is
 * floored). Each completed month m accrues `price * schedule[min(m, len-1)]
 * / 10_000`; the final schedule entry repeats indefinitely.
 *
 * Throws when the schedule is empty (mirrors the contract panic).
 */
export function calculateAccruedInterest(
  schedule: readonly (number | bigint)[],
  elapsedMonths: number,
  declaredPriceUsd: bigint | number | string = DEFAULT_DECLARED_PRICE_USD,
): bigint {
  if (schedule.length === 0) {
    throw new Error("interest schedule must not be empty");
  }
  if (!Number.isFinite(elapsedMonths)) {
    throw new TypeError("elapsedMonths must be a finite number");
  }

  const price = toBigInt(declaredPriceUsd, "declaredPriceUsd");
  const fullMonths = Math.max(0, Math.floor(elapsedMonths));

  let total = 0n;
  for (let m = 0; m < fullMonths; m += 1) {
    const index = Math.min(m, schedule.length - 1);
    const rate = toBigInt(schedule[index], `schedule[${index}]`);
    total += (price * rate) / 10_000n;
  }
  return total;
}

/**
 * Health factor in basis points for a position.
 *
 * Replicates the contract formula:
 *   health_factor_bps = collateral_usd_value * 10_000 / debt_usd
 * where `debt` is the declared price plus accrued interest (7-decimal USD).
 *
 * A position with zero debt is considered infinitely healthy and returns
 * `MAX_HEALTH_FACTOR_BPS`.
 */
export function calculateHealthFactor(
  collateral: bigint | number | string,
  debt: bigint | number | string,
): bigint {
  const collateralUsd = toBigInt(collateral, "collateral");
  const debtUsd = toBigInt(debt, "debt");

  if (debtUsd <= 0n) return MAX_HEALTH_FACTOR_BPS;
  return (collateralUsd * HEALTH_FACTOR_SCALE) / debtUsd;
}