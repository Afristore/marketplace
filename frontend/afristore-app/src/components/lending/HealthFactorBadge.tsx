// ─────────────────────────────────────────────────────────────
// components/lending/HealthFactorBadge.tsx
// ─────────────────────────────────────────────────────────────
// Presentational pill showing a lending position's health factor,
// colour-coded by liquidation risk. The health factor is supplied
// in basis points (10_000 bps = 100%), matching the on-chain
// representation produced by `calculateHealthFactor` in
// `@/lib/lendingMath` (Soroban i128 values arrive as bigint).
//
// Risk tiers (asymmetric boundaries — read carefully):
//   healthy       HF  >  150%            (15_000 bps exactly is NOT healthy)
//   caution       110% < HF <= 150%      (15_000 bps exactly IS caution)
//   liquidatable  HF <= 110%             (11_000 bps exactly IS liquidatable)
//──────────────────────────────────────────────────────────────

import clsx from "clsx";
import {
  AlertOctagon,
  AlertTriangle,
  HelpCircle,
  ShieldCheck,
} from "lucide-react";
import { MAX_HEALTH_FACTOR_BPS } from "@/lib/lendingMath";

/** HF strictly above this (bps) is healthy — 150%. */
export const HEALTHY_HF_BPS = 15_000n;
/** HF at or below this (bps) is liquidatable — 110%. */
export const LIQUIDATABLE_HF_BPS = 11_000n;

export type HealthFactorRisk =
  | "healthy"
  | "caution"
  | "liquidatable"
  | "unknown";

export interface HealthFactorBadgeProps {
  /**
   * Position health factor in basis points (10_000 bps = 100%).
   * `bigint` is the canonical type; plain integers are accepted for
   * convenience. `null`/`undefined`/non-finite values render a neutral
   * "unknown" badge rather than crashing.
   */
  healthFactorBps: bigint | number | null | undefined;
  /** Extra classes for layout composition by the caller. */
  className?: string;
}

const RISK_STYLES: Record<HealthFactorRisk, string> = {
  healthy: "bg-mint-500/15 text-mint-300 ring-1 ring-mint-500/30",
  caution: "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30",
  liquidatable: "bg-red-500/15 text-red-300 ring-1 ring-red-500/30",
  unknown: "bg-white/5 text-white/50 ring-1 ring-white/10",
};

const RISK_LABEL: Record<HealthFactorRisk, string> = {
  healthy: "healthy",
  caution: "moderate liquidation risk",
  liquidatable: "at risk of liquidation",
  unknown: "unknown",
};

const RISK_ICON: Record<HealthFactorRisk, typeof ShieldCheck> = {
  healthy: ShieldCheck,
  caution: AlertTriangle,
  liquidatable: AlertOctagon,
  unknown: HelpCircle,
};

/** Coerce the incoming value to bigint bps, or `null` when it is not usable. */
function toHealthFactorBps(
  value: bigint | number | null | undefined,
): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return BigInt(Math.trunc(value));
  }
  return null;
}

/** Map a health factor in bps to its risk tier (asymmetric boundaries). */
export function classifyHealthFactor(bps: bigint): HealthFactorRisk {
  if (bps > HEALTHY_HF_BPS) return "healthy";
  if (bps > LIQUIDATABLE_HF_BPS) return "caution";
  return "liquidatable";
}

/** Render bps as a percentage string, e.g. 14285 -> "142.85%". */
function formatHealthFactor(bps: bigint): string {
  const sign = bps < 0n ? "-" : "";
  const abs = bps < 0n ? -bps : bps;
  const whole = abs / 100n;
  const frac = (abs % 100n).toString().padStart(2, "0");
  return `${sign}${whole}.${frac}%`;
}

export function HealthFactorBadge({
  healthFactorBps,
  className,
}: HealthFactorBadgeProps) {
  const bps = toHealthFactorBps(healthFactorBps);

  // No debt: the contract returns a sentinel; there is nothing to liquidate.
  const noDebt = bps !== null && bps >= MAX_HEALTH_FACTOR_BPS;

  const risk: HealthFactorRisk =
    bps === null ? "unknown" : noDebt ? "healthy" : classifyHealthFactor(bps);

  const display =
    bps === null || noDebt ? "—" : formatHealthFactor(bps);

  const Icon = RISK_ICON[risk];
  const description =
    bps === null
      ? "Health factor unknown"
      : noDebt
        ? "Health factor — no outstanding debt"
        : `Health factor ${display}, ${RISK_LABEL[risk]}`;

  return (
    <span
      role="status"
      data-testid="health-factor-badge"
      data-risk={risk}
      title={description}
      aria-label={description}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-xs font-bold",
        RISK_STYLES[risk],
        risk === "liquidatable" && "animate-pulse",
        className,
      )}
    >
      <Icon size={13} aria-hidden="true" />
      <span>{display}</span>
    </span>
  );
}
