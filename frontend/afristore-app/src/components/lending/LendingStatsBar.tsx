// ─────────────────────────────────────────────────────────────
// components/lending/LendingStatsBar.tsx
// ─────────────────────────────────────────────────────────────
// Horizontal bar of protocol-wide lending metrics: Total Value
// Locked, Active Loans and Volume. Consumes `useLendingStats`
// (`@/hooks/useLendingStats`); TVL and Volume arrive as bigint
// USD in the protocol's 7-decimal fixed-point form, Active Loans
// as a plain count.
//
// States:
//   loading  → all three tiles show a pulsing skeleton
//   error    → tiles render an em dash placeholder + a quiet
//              "Stats unavailable" status line
//   ready    → formatted values
//──────────────────────────────────────────────────────────────

"use client";

import clsx from "clsx";
import { HandCoins, Landmark, TrendingUp } from "lucide-react";
import { USD_DECIMALS } from "@/lib/lendingMath";
import { useLendingStats } from "@/hooks/useLendingStats";

const EM_DASH = "—";

/** Render 7-decimal fixed-point USD as a compact string, e.g. 1_250_000_0000000n -> "$1.3M". */
function formatUsdCompact(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const whole = Number(abs / USD_DECIMALS);
  const frac = Number(abs % USD_DECIMALS) / Number(USD_DECIMALS);
  const dollars = whole + frac;
  const formatted = Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(dollars);
  return `$${sign}${formatted}`;
}

/** Render a plain count with thousands separators, e.g. 1234 -> "1,234". */
function formatCount(value: number): string {
  return Intl.NumberFormat("en-US").format(Math.trunc(value));
}

interface LendingStatsBarProps {
  /** Extra classes for layout composition by the caller. */
  className?: string;
}

export function LendingStatsBar({ className }: LendingStatsBarProps) {
  const { stats, loading, error } = useLendingStats();

  const state = loading
    ? "loading"
    : error
      ? "error"
      : stats
        ? "ready"
        : "empty";

  return (
    <div
      data-testid="lending-stats-bar"
      data-state={state}
      className={clsx("w-full", className)}
    >
      <div className="grid grid-cols-1 gap-4 rounded-3xl border border-white/5 bg-midnight-900/60 p-1 backdrop-blur-xl sm:grid-cols-3">
        <StatTile
          icon={<Landmark size={18} />}
          label="Total Value Locked"
          testId="stat-tvl"
          loading={state === "loading"}
          value={
            state === "ready" ? formatUsdCompact(stats!.tvlUsd) : EM_DASH
          }
        />
        <StatTile
          icon={<HandCoins size={18} />}
          label="Active Loans"
          testId="stat-active-loans"
          loading={state === "loading"}
          value={
            state === "ready" ? formatCount(stats!.activeLoans) : EM_DASH
          }
        />
        <StatTile
          icon={<TrendingUp size={18} />}
          label="Volume"
          testId="stat-volume"
          loading={state === "loading"}
          value={
            state === "ready" ? formatUsdCompact(stats!.volumeUsd) : EM_DASH
          }
        />
      </div>

      {state === "error" && (
        <p role="status" className="mt-2 px-4 text-xs text-white/40">
          Stats unavailable
        </p>
      )}
    </div>
  );
}

interface StatTileProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  testId: string;
  loading: boolean;
}

function StatTile({ icon, label, value, testId, loading }: StatTileProps) {
  return (
    <div className="flex items-center gap-3 rounded-[1.375rem] bg-white/[0.02] px-4 py-4">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-400 ring-1 ring-brand-500/20">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-wider text-white/40">
          {label}
        </p>
        {loading ? (
          <span
            data-testid={`${testId}-skeleton`}
            className="mt-1.5 block h-6 w-24 animate-pulse rounded-full bg-white/5"
          />
        ) : (
          <p
            data-testid={testId}
            className="font-mono text-xl font-bold text-white"
          >
            {value}
          </p>
        )}
      </div>
    </div>
  );
}
