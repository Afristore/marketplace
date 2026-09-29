// ─────────────────────────────────────────────────────────────
// components/lending/LenderDashboardTable.tsx
// ─────────────────────────────────────────────────────────────
// Table for lenders showing the status of their escrowed NFTs
// (Open, Active Loan, Repaid, Liquidated). Includes a
// "Cancel Listing" action for Open rows and displays earned
// interest for Active / Repaid rows.
// ─────────────────────────────────────────────────────────────

"use client";

import { Loader2, XCircle } from "lucide-react";
import clsx from "clsx";

export type LenderListingStatus = "Open" | "Active Loan" | "Repaid" | "Liquidated";

export interface LenderListingRow {
  /** Unique listing / position id. */
  id: number | string;
  nftContract: string;
  tokenId: number | bigint;
  /** Principal (declared price) in USD, 7-decimal fixed-point. */
  principalUsd: bigint;
  /** Interest earned so far in USD, 7-decimal fixed-point. */
  earnedInterestUsd: bigint;
  /** Contract address of the collateral currency. */
  currency: string;
  status: LenderListingStatus;
}

export interface LenderDashboardTableProps {
  rows: LenderListingRow[];
  isLoading?: boolean;
  /** Id of the listing currently being cancelled (for pending state). */
  cancellingId?: number | string | null;
  onCancelListing?: (row: LenderListingRow) => void;
}

const STATUS_STYLES: Record<LenderListingStatus, string> = {
  Open: "bg-brand-500/15 text-brand-300 ring-1 ring-brand-500/30",
  "Active Loan": "bg-mint-500/15 text-mint-300 ring-1 ring-mint-500/30",
  Repaid: "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/30",
  Liquidated: "bg-red-500/15 text-red-300 ring-1 ring-red-500/30",
};

function formatUsd(value: bigint): string {
  const whole = value / 10_000_000n;
  const cents = (value % 10_000_000n) / 100_000n;
  return `$${Intl.NumberFormat("en-US").format(whole)}.${cents
    .toString()
    .padStart(2, "0")}`;
}

export function LenderDashboardTable({
  rows,
  isLoading = false,
  cancellingId = null,
  onCancelListing,
}: LenderDashboardTableProps) {
  if (isLoading) {
    return (
      <div
        data-testid="lender-table-loading"
        className="flex items-center justify-center gap-3 py-16 text-white/50"
      >
        <Loader2 size={20} className="animate-spin" />
        <span className="text-sm">Loading your escrowed NFTs…</span>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div
        data-testid="lender-table-empty"
        className="rounded-3xl bg-midnight-900/40 border border-white/5 p-12 text-center"
      >
        <h3 className="text-lg font-bold text-white mb-2">No Listings Yet</h3>
        <p className="text-sm text-white/50 max-w-md mx-auto">
          You have not escrowed any NFTs for lending. Create a listing to start
          earning interest.
        </p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-3xl bg-midnight-900/60 border border-white/5 backdrop-blur-xl">
      <div className="overflow-x-auto">
        <table
          data-testid="lender-dashboard-table"
          className="w-full min-w-[720px] text-left text-sm"
        >
          <thead>
            <tr className="border-b border-white/10 text-[11px] uppercase tracking-wider text-white/40">
              <th className="px-5 py-4 font-bold">NFT</th>
              <th className="px-5 py-4 font-bold">Principal</th>
              <th className="px-5 py-4 font-bold">Earned Interest</th>
              <th className="px-5 py-4 font-bold">Currency</th>
              <th className="px-5 py-4 font-bold">Status</th>
              <th className="px-5 py-4 text-right font-bold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <LenderRow
                key={row.id}
                row={row}
                isCancelling={cancellingId !== null && cancellingId === row.id}
                onCancelListing={onCancelListing}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


interface LenderRowProps {
  row: LenderListingRow;
  isCancelling: boolean;
  onCancelListing?: (row: LenderListingRow) => void;
}

function LenderRow({ row, isCancelling, onCancelListing }: LenderRowProps) {
  return (
    <tr className="border-b border-white/5 transition-colors last:border-0 hover:bg-white/[0.03]">
      <td className="px-5 py-4">
        <div className="flex flex-col">
          <span className="font-mono text-[11px] text-white/40">
            {row.nftContract}
          </span>
          <span className="text-white">#{row.tokenId.toString()}</span>
        </div>
      </td>
      <td className="px-5 py-4 font-medium text-white">
        {formatUsd(row.principalUsd)}
      </td>
      <td className="px-5 py-4">
        {row.status === "Active Loan" || row.status === "Repaid" ? (
          <span
            data-testid={`earned-interest-${row.id}`}
            className="font-medium text-mint-400"
          >
            +{formatUsd(row.earnedInterestUsd)}
          </span>
        ) : (
          <span className="text-white/30">—</span>
        )}
      </td>
      <td className="px-5 py-4 font-mono text-xs text-white/60">
        {row.currency}
      </td>
      <td className="px-5 py-4">
        <span
          className={clsx(
            "rounded-full px-2.5 py-1 text-[11px] font-semibold",
            STATUS_STYLES[row.status],
          )}
        >
          {row.status}
        </span>
      </td>
      <td className="px-5 py-4 text-right">
        {row.status === "Open" && onCancelListing ? (
          <button
            type="button"
            data-testid={`cancel-listing-${row.id}`}
            disabled={isCancelling}
            onClick={() => onCancelListing(row)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-red-500/10 px-3 py-1.5 text-xs font-semibold text-red-300 ring-1 ring-red-500/30 transition-colors hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isCancelling ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <XCircle size={13} />
            )}
            Cancel Listing
          </button>
        ) : (
          <span className="text-white/20">—</span>
        )}
      </td>
    </tr>
  );
}

