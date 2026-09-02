// ─────────────────────────────────────────────────────────────
// components/lending/RepayLoanModal.tsx
// ─────────────────────────────────────────────────────────────
// Modal that breaks down the exact fees required to close a
// borrow position (Principal, Interest, Platform Fee) and
// retrieve the NFT. Executes the repayment via `useReturnNFT`.
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
  /** Called after a successful repayment. */
  onSuccess?: () => void;
}

function formatUsd(value: bigint): string {
  const whole = value / 10_000_000n;
  const cents = (value % 10_000_000n) / 100_000n;
  return `$${Intl.NumberFormat("en-US").format(whole)}.${cents
    .toString()
    .padStart(2, "0")}`;
}

function FeeRow({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
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
        {label}
      </span>
      <span
        data-testid={emphasis ? "repay-total" : undefined}
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
    const ok = await returnNFT(position.id);
    if (ok) {
      setSuccess(true);
      onSuccess?.();
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
      <div className="mb-5 space-y-3 rounded-2xl bg-white/[0.03] p-4 ring-1 ring-white/5">
        <FeeRow label="Principal" value={fees ? formatUsd(fees.principalUsd) : "—"} />
        <FeeRow
          label="Accrued Interest"
          value={fees ? formatUsd(fees.accruedInterestUsd) : "—"}
        />
        <FeeRow
          label={`Platform Fee (${(platformFeeBps / 100).toFixed(2)}%)`}
          value={fees ? formatUsd(fees.platformFeeUsd) : "—"}
        />
        <FeeRow
          label="Total Required"
          value={fees ? formatUsd(fees.totalRequiredUsd) : "—"}
          emphasis
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

