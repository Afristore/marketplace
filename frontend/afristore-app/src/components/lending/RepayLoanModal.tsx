// ─────────────────────────────────────────────────────────────
// components/lending/RepayLoanModal.tsx
// ─────────────────────────────────────────────────────────────
// Modal that itemises the debt required to close a borrow
// position (Principal, Accrued Interest, Platform Fee), the
// collateral deposited, and the estimated collateral refund,
// then executes the repayment via `useReturnNFT`.
// ─────────────────────────────────────────────────────────────

"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";
import { calculateReturnFees, type Position } from "@/lib/lending";
import { useReturnNFT } from "@/hooks/mutations/useReturnNFT";

export interface RepayLoanModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** The active borrow position to repay. */
  position: Position | null;
  /** Connected borrower public key (required to sign the tx). */
  borrowerPublicKey?: string | null;
  /** Platform fee in bps (defaults to 1% / 100 bps). */
  platformFeeBps?: number;
  /**
   * Oracle price of the collateral token in USD (7 decimals per 1 token).
   * When provided, the modal estimates the collateral refunded to the
   * borrower after settlement; otherwise the refund is shown as unavailable.
   */
  collateralPriceUsd?: bigint | null;
  /** Display symbol for the collateral token (e.g. "XLM", "USDC"). */
  collateralSymbol?: string;
  /** Called after a successful repayment. */
  onSuccess?: () => void;
}

/** Fixed-point scale shared by USD values and token amounts (7 decimals). */
const DECIMALS = 10_000_000n;

/**
 * Estimates the collateral returned to the borrower on voluntary repayment.
 * Mirrors the contract's settlement waterfall:
 *   debit_tokens = total_owed_usd * DECIMALS / oracle_price
 *   refund       = max(collateral_amount - debit_tokens, 0)
 * Returns null when no valid oracle price is available.
 */
export function estimateCollateralRefund(
  collateralAmount: bigint,
  totalRequiredUsd: bigint,
  collateralPriceUsd: bigint | null | undefined,
): bigint | null {
  if (collateralPriceUsd == null || collateralPriceUsd <= 0n) return null;
  const debitTokens = (totalRequiredUsd * DECIMALS) / collateralPriceUsd;
  return collateralAmount > debitTokens ? collateralAmount - debitTokens : 0n;
}

function formatUsd(value: bigint): string {
  const whole = value / 10_000_000n;
  const cents = (value % 10_000_000n) / 100_000n;
  return `$${Intl.NumberFormat("en-US").format(whole)}.${cents
    .toString()
    .padStart(2, "0")}`;
}

function formatTokenAmount(value: bigint, symbol: string): string {
  const whole = value / DECIMALS;
  const frac = (value % DECIMALS).toString().padStart(7, "0").slice(0, 4);
  return `${Intl.NumberFormat("en-US").format(whole)}.${frac} ${symbol}`.trim();
}

function FeeRow({
  label,
  value,
  emphasis = false,
  hint,
  testId,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
  hint?: string;
  testId?: string;
}) {
  return (
    <div
      className={
        emphasis
          ? "flex items-center justify-between border-t border-white/10 pt-3 text-sm"
          : "flex items-center justify-between text-sm"
      }
    >
      <span className={emphasis ? "font-bold text-white" : "text-white/60"}>
        <span>{label}</span>
        {hint && (
          <span className="block text-[11px] font-normal text-white/40">
            {hint}
          </span>
        )}
      </span>
      <span
        data-testid={testId ?? (emphasis ? "repay-total" : undefined)}
        className={
          emphasis ? "font-bold text-mint-400" : "font-medium text-white/90"
        }
      >
        {value}
      </span>
    </div>
  );
}

export function RepayLoanModal({
  isOpen,
  onClose,
  position,
  borrowerPublicKey,
  platformFeeBps = 100,
  collateralPriceUsd,
  collateralSymbol = "",
  onSuccess,
}: RepayLoanModalProps) {
  const { returnNFT, isReturningNFT, error } = useReturnNFT(borrowerPublicKey);
  const [success, setSuccess] = useState(false);

  const fees = useMemo(() => {
    if (!position) return null;
    try {
      return calculateReturnFees(position, platformFeeBps);
    } catch {
      return null;
    }
  }, [position, platformFeeBps]);

  const collateralRefund = useMemo(() => {
    if (!position || !fees) return null;
    try {
      return estimateCollateralRefund(
        BigInt(position.collateral_amount),
        fees.totalRequiredUsd,
        collateralPriceUsd,
      );
    } catch {
      return null;
    }
  }, [position, fees, collateralPriceUsd]);

  // Reset transient state whenever the modal opens.
  useEffect(() => {
    if (isOpen) setSuccess(false);
  }, [isOpen]);

  // Close on Escape for accessibility.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose]);

  if (!isOpen || !position) return null;

  const handleRepay = async () => {
    try {
      const ok = await returnNFT(position.id);
      if (ok) {
        setSuccess(true);
        onSuccess?.();
      }
    } catch {
      // `useReturnNFT` already converts failures into an error state and a
      // toast; catching here guarantees the modal can never leak an
      // unhandled promise rejection.
    }
  };

  return (
    <div
      data-testid="repay-loan-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Repay loan"
    >
      <div className="w-full max-w-md rounded-3xl bg-midnight-900 border border-white/10 p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-white">Repay Loan</h2>
            <p className="text-xs text-white/50">
              Position #{position.id.toString()} — close the position to
              retrieve your NFT.
            </p>
          </div>
          <button
            type="button"
            data-testid="repay-modal-close"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-white/50 transition-colors hover:bg-white/5 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>
        <RepayModalBody
          fees={fees}
          platformFeeBps={platformFeeBps}
          collateralAmount={BigInt(position.collateral_amount)}
          collateralRefund={collateralRefund}
          collateralSymbol={collateralSymbol}
          error={error}
          success={success}
          isReturningNFT={isReturningNFT}
          canRepay={Boolean(borrowerPublicKey) && Boolean(fees)}
          onClose={onClose}
          onRepay={handleRepay}
        />
      </div>
    </div>
  );
}


interface RepayModalBodyProps {
  fees: {
    principalUsd: bigint;
    accruedInterestUsd: bigint;
    platformFeeUsd: bigint;
    totalRequiredUsd: bigint;
  } | null;
  platformFeeBps: number;
  collateralAmount: bigint;
  collateralRefund: bigint | null;
  collateralSymbol: string;
  error: string | null;
  success: boolean;
  isReturningNFT: boolean;
  canRepay: boolean;
  onClose: () => void;
  onRepay: () => void;
}

function RepayModalBody({
  fees,
  platformFeeBps,
  collateralAmount,
  collateralRefund,
  collateralSymbol,
  error,
  success,
  isReturningNFT,
  canRepay,
  onClose,
  onRepay,
}: RepayModalBodyProps) {
  if (success) {
    return (
      <div className="flex flex-col items-center gap-3 py-8 text-center">
        <CheckCircle2 size={40} className="text-mint-400" />
        <p className="font-bold text-white">Loan repaid successfully!</p>
        <p className="text-sm text-white/50">
          Your NFT has been released back to you.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 rounded-xl bg-mint-500 px-5 py-2 text-sm font-bold text-midnight-900 transition-opacity hover:opacity-90"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <>
      <div
        data-testid="repay-debt-breakdown"
        className="mb-5 space-y-3 rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/5"
      >
        <p className="text-[11px] font-semibold uppercase tracking-wider text-white/40">
          Debt Breakdown
        </p>
        <FeeRow
          label="Principal Debt"
          value={fees ? formatUsd(fees.principalUsd) : "—"}
          testId="repay-principal"
        />
        <FeeRow
          label="Accrued Interest"
          hint="Interest accumulated since the loan started"
          value={fees ? formatUsd(fees.accruedInterestUsd) : "—"}
          testId="repay-interest"
        />
        <FeeRow
          label={`Platform Fee (${(platformFeeBps / 100).toFixed(2)}%)`}
          value={fees ? formatUsd(fees.platformFeeUsd) : "—"}
          testId="repay-platform-fee"
        />
        <FeeRow
          label="Total Required"
          value={fees ? formatUsd(fees.totalRequiredUsd) : "—"}
          emphasis
        />
      </div>

      <div
        data-testid="repay-collateral-summary"
        className="mb-5 space-y-3 rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/5"
      >
        <p className="text-[11px] font-semibold uppercase tracking-wider text-white/40">
          Collateral
        </p>
        <FeeRow
          label="Collateral Deposited"
          value={formatTokenAmount(collateralAmount, collateralSymbol)}
          testId="repay-collateral-deposited"
        />
        <FeeRow
          label="Estimated Collateral Refund"
          hint={
            collateralRefund === null
              ? "Requires a live collateral price"
              : "Final amount depends on the oracle price at settlement"
          }
          value={
            collateralRefund === null
              ? "—"
              : formatTokenAmount(collateralRefund, collateralSymbol)
          }
          testId="repay-collateral-refund"
        />
      </div>

      {error && (
        <div
          data-testid="repay-error"
          className="mb-4 flex items-start gap-2 rounded-xl bg-red-500/10 p-3 text-xs text-red-300 ring-1 ring-red-500/30"
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onClose}
          disabled={isReturningNFT}
          className="flex-1 rounded-xl bg-white/5 px-4 py-2.5 text-sm font-semibold text-white/70 ring-1 ring-white/10 transition-colors hover:bg-white/10 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="repay-confirm"
          onClick={onRepay}
          disabled={isReturningNFT || !canRepay}
          className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-mint-500 px-4 py-2.5 text-sm font-bold text-midnight-900 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isReturningNFT && <Loader2 size={15} className="animate-spin" />}
          {isReturningNFT ? "Repaying…" : "Repay & Retrieve NFT"}
        </button>
      </div>
    </>
  );
}

