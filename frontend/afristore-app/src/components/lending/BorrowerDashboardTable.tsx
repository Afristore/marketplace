// ─────────────────────────────────────────────────────────────
// components/lending/BorrowerDashboardTable.tsx
// ─────────────────────────────────────────────────────────────
// Lists every active debt (borrow position) for the logged-in
// user as a table: Current Debt, Health Factor and row actions
// (Top Up / Repay / Manage). Sortable by Health Factor.
//──────────────────────────────────────────────────────────────

"use client";

import { useMemo, useState } from "react";
import {
  ArrowDownUp,
  ArrowUpDown,
  Coins,
  HandCoins,
  Landmark,
  Loader2,
  Wallet,
} from "lucide-react";
import clsx from "clsx";
import {
  calculateAccruedInterest,
  calculateHealthFactor,
  MAX_HEALTH_FACTOR_BPS,
  toBigInt,
} from "@/lib/lendingMath";

export interface BorrowerDebt {
  /** Unique on-chain position id. */
  positionId: number;
  nftName?: string;
  nftContract?: string;
  tokenId?: number;
  /** Declared price / principal in USD, 7-decimal fixed-point. */
  declaredPriceUsd: bigint | number | string;
  /** Contract address of the collateral token. */
  collateralCurrency: string;
  /** Current collateral USD value, 7-decimal fixed-point. */
  collateralUsdValue: bigint | number | string;
  /** Per-month interest schedule in bps (last entry repeats). */
  interestScheduleBps: readonly (number | bigint)[];
  /** Whole months elapsed since the position was opened. */
  elapsedMonths: number;
  /** Liquidation threshold in bps, e.g. 11000 = 110%. */
  liquidationThresholdBps: number;
}

export type HealthFactorSortOrder = "asc" | "desc";

interface BorrowerDashboardTableProps {
  debts: BorrowerDebt[];
  onTopUp?: (debt: BorrowerDebt) => void;
  onRepay?: (debt: BorrowerDebt) => void;
  isLoading?: boolean;
}

interface DerivedRow {
  debt: BorrowerDebt;
  currentDebtUsd: bigint;
  healthFactorBps: bigint;
}

function formatUsd(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const whole = abs / 10_000_000n;
  const cents = (abs % 10_000_000n) / 100_000n;
  const wholeStr = Intl.NumberFormat("en-US").format(whole);
  const centsStr = cents.toString().padStart(2, "0");
  return `$${sign}${wholeStr}.${centsStr}`;
}

function formatHealthFactor(hf: bigint): string {
  if (hf >= MAX_HEALTH_FACTOR_BPS) return "\u2014"; // em dash, no debt
  const whole = hf / 100n;
  const frac = (hf % 100n).toString().padStart(2, "0");
  return `${whole}.${frac}%`;
}

function healthFactorTone(hf: bigint, liquidationThresholdBps: number): string {
  if (hf >= MAX_HEALTH_FACTOR_BPS) {
    return "bg-white/5 text-white/50 ring-1 ring-white/10";
  }
  if (hf <= BigInt(liquidationThresholdBps)) {
    return "bg-red-500/15 text-red-300 ring-1 ring-red-500/30";
  }
  if (hf < BigInt(liquidationThresholdBps) + 2000n) {
    return "bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/30";
  }
  return "bg-mint-500/15 text-mint-300 ring-1 ring-mint-500/30";
}

export function BorrowerDashboardTable({
  debts,
  onTopUp,
  onRepay,
  isLoading = false,
}: BorrowerDashboardTableProps) {
  const [sortOrder, setSortOrder] = useState<HealthFactorSortOrder>("asc");
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => new Set());

  const toggleExpand = (positionId: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(positionId)) {
        next.delete(positionId);
      } else {
        next.add(positionId);
      }
      return next;
    });
  };

  const rows = useMemo<DerivedRow[]>(() => {
    const derived = debts.map((debt) => {
      const principal = toBigInt(debt.declaredPriceUsd, "declaredPriceUsd");
      const accrued = calculateAccruedInterest(
        debt.interestScheduleBps,
        debt.elapsedMonths,
        principal,
      );
      const currentDebtUsd = principal + accrued;
      const healthFactorBps = calculateHealthFactor(
        toBigInt(debt.collateralUsdValue, "collateralUsdValue"),
        currentDebtUsd,
      );
      return { debt, currentDebtUsd, healthFactorBps };
    });

    return derived.sort((a, b) => {
      const diff = a.healthFactorBps - b.healthFactorBps;
      return sortOrder === "asc" ? Number(diff) : Number(-diff);
    });
  }, [debts, sortOrder]);

  const toggleSort = () => {
    setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-3 py-16 text-white/50">
        <Loader2 size={20} className="animate-spin" />
        <span className="text-sm">Loading your active debts…</span>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-3xl bg-midnight-900/40 border border-white/5 p-12 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-mint-500/10 text-mint-400 mb-4 ring-1 ring-mint-500/20">
          <Coins size={32} />
        </div>
        <h3 className="text-lg font-bold text-white mb-2">No Active Debts</h3>
        <p className="text-sm text-white/50 max-w-md mx-auto">
          You do not have any open borrow positions. Browse lending listings to
          borrow against your NFTs.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-3xl bg-midnight-900/60 border border-white/5 backdrop-blur-xl">
      <div className="overflow-x-auto">
        <table data-testid="borrower-debts-table" className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-white/40">
              <th className="px-5 py-4 font-bold">Position</th>
              <th className="px-5 py-4 font-bold">Current Debt</th>
              <th className="px-5 py-4 font-bold">
                <button
                  type="button"
                  onClick={toggleSort}
                  aria-label={`Sort by health factor (currently ${sortOrder === "asc" ? "ascending" : "descending"})`}
                  className="group inline-flex items-center gap-1.5 text-white/40 hover:text-white transition-colors"
                >
                  Health Factor
                  {sortOrder === "asc" ? (
                    <ArrowUpDown size={13} className="text-brand-400" />
                  ) : (
                    <ArrowDownUp size={13} className="text-brand-400" />
                  )}
                </button>
              </th>
              <th className="px-5 py-4 text-right font-bold">Collateral</th>
              <th className="px-5 py-4 text-right font-bold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ debt, currentDebtUsd, healthFactorBps }) => {
              const expanded = expandedIds.has(debt.positionId);
              return (
                <FragmentRow
                  key={debt.positionId}
                  debt={debt}
                  currentDebtUsd={currentDebtUsd}
                  healthFactorBps={healthFactorBps}
                  expanded={expanded}
                  onToggleExpand={() => toggleExpand(debt.positionId)}
                  onTopUp={onTopUp ? () => onTopUp(debt) : undefined}
                  onRepay={onRepay ? () => onRepay(debt) : undefined}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface FragmentRowProps {
  debt: BorrowerDebt;
  currentDebtUsd: bigint;
  healthFactorBps: bigint;
  expanded: boolean;
  onToggleExpand: () => void;
  onTopUp?: () => void;
  onRepay?: () => void;
}

function FragmentRow({
  debt,
  currentDebtUsd,
  healthFactorBps,
  expanded,
  onToggleExpand,
  onTopUp,
  onRepay,
}: FragmentRowProps) {
  return (
    <>
      <tr
        data-testid={`debt-row-${debt.positionId}`}
        className={clsx(
          "border-b border-white/5 transition-colors hover:bg-white/[0.03]",
          expanded && "bg-brand-500/[0.04]",
        )}
      >
        <td className="px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-500/10 text-brand-400 ring-1 ring-brand-500/20">
              <Landmark size={18} />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-white truncate">
                {debt.nftName ?? `Position #${debt.positionId}`}
              </p>
              <p className="font-mono text-[11px] text-white/40">
                #{debt.positionId}
                {debt.tokenId !== undefined ? ` · Token #${debt.tokenId}` : ""}
              </p>
            </div>
          </div>
        </td>

        <td className="px-5 py-4">
          <span className="font-mono text-white font-semibold">
            {formatUsd(currentDebtUsd)}
          </span>
        </td>

        <td className="px-5 py-4">
          <span
            className={clsx(
              "inline-flex items-center rounded-full px-2.5 py-1 font-mono text-xs font-bold",
              healthFactorTone(healthFactorBps, debt.liquidationThresholdBps),
            )}
          >
            {formatHealthFactor(healthFactorBps)}
          </span>
        </td>

        <td className="px-5 py-4 text-right">
          <span className="font-mono text-xs text-white/60">
            {debt.collateralCurrency.slice(0, 6)}…{debt.collateralCurrency.slice(-4)}
          </span>
        </td>

        <td className="px-5 py-4">
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              data-testid={`top-up-${debt.positionId}`}
              onClick={onTopUp}
              disabled={!onTopUp}
              className="inline-flex items-center gap-1.5 rounded-xl bg-mint-500/10 border border-mint-500/25 px-3 py-1.5 text-xs font-bold text-mint-300 hover:bg-mint-500/20 transition-all disabled:cursor-not-allowed disabled:opacity-40"
            >
              <HandCoins size={14} />
              Top Up
            </button>
            <button
              type="button"
              data-testid={`repay-${debt.positionId}`}
              onClick={onRepay}
              disabled={!onRepay}
              className="inline-flex items-center gap-1.5 rounded-xl bg-white/5 border border-white/10 px-3 py-1.5 text-xs font-bold text-white/80 hover:bg-white/10 hover:text-white transition-all disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Wallet size={14} />
              Repay
            </button>
            <button
              type="button"
              data-testid={`manage-${debt.positionId}`}
              onClick={onToggleExpand}
              aria-expanded={expanded}
              aria-label={`Manage position ${debt.positionId}`}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-brand-500 to-terracotta-500 px-3 py-1.5 text-xs font-bold text-white shadow-lg shadow-brand-500/20 hover:opacity-95 transition-all"
            >
              Manage
            </button>
          </div>
        </td>
      </tr>

      {expanded && (
        <tr data-testid={`manage-detail-${debt.positionId}`} className="bg-midnight-950/40">
          <td colSpan={5} className="px-5 py-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
              <div className="rounded-2xl bg-white/[0.02] border border-white/5 p-3">
                <p className="text-white/40 mb-1">Principal</p>
                <p className="font-mono text-white font-semibold">
                  {formatUsd(toBigInt(debt.declaredPriceUsd, "declaredPriceUsd"))}
                </p>
              </div>
              <div className="rounded-2xl bg-white/[0.02] border border-white/5 p-3">
                <p className="text-white/40 mb-1">Accrued Interest</p>
                <p className="font-mono text-white font-semibold">
                  {formatUsd(
                    currentDebtUsd -
                      toBigInt(debt.declaredPriceUsd, "declaredPriceUsd"),
                  )}
                </p>
              </div>
              <div className="rounded-2xl bg-white/[0.02] border border-white/5 p-3">
                <p className="text-white/40 mb-1">Liquidation Threshold</p>
                <p className="font-mono text-white font-semibold">
                  {(debt.liquidationThresholdBps / 100).toFixed(2)}%
                </p>
              </div>
              <div className="rounded-2xl bg-white/[0.02] border border-white/5 p-3">
                <p className="text-white/40 mb-1">Interest Schedule</p>
                <p className="font-mono text-white font-semibold truncate">
                  {debt.interestScheduleBps.join(" · ")} bps
                </p>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}