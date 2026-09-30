// ─────────────────────────────────────────────────────────────
// components/lending/LendingStatsBar.tsx
// ─────────────────────────────────────────────────────────────
// Horizontal bar of protocol-wide lending metrics: Total Value
// Locked, Active Loans and 24h Volume. Consumes `useLendingStats`
// (`@/hooks/useLendingStats`); TVL and Volume arrive as plain
// numbers denominated in XLM, Active Loans as a plain count.
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
import { useLendingStats } from "@/hooks/useLendingStats";

const EM_DASH = "—";

/** Render an XLM amount compactly, e.g. 1250000 -> "1.3M XLM". */
function formatXlmCompact(value: number): string {
  const formatted = Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
  return `${formatted} XLM`;
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
  const { stats, isLoading, error } = useLendingStats();

  const state = isLoading
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
          value={state === "ready" ? formatXlmCompact(stats!.tvl) : EM_DASH}
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
          label="24h Volume"
          testId="stat-volume"
          loading={state === "loading"}
          value={
            state === "ready" ? formatXlmCompact(stats!.volume24h) : EM_DASH
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
