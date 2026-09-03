// ─────────────────────────────────────────────────────────────
// components/lending/BorrowConfirmModal.tsx
// ─────────────────────────────────────────────────────────────
// A confirmation modal that displays the exact collateral needed
// to borrow against a selected NFT, warns the user about
// liquidation risks, and executes the borrow transaction through
// the `useBorrowTransaction` hook on submit.
//──────────────────────────────────────────────────────────────

"use client";

import { useEffect } from "react";
import Image from "next/image";
import {
  AlertTriangle,
  Coins,
  Eye,
  Image as ImageIcon,
  Loader2,
  ShieldAlert,
  Timer,
  X,
} from "lucide-react";
import { useWalletContext } from "@/context/WalletContext";
import { useBorrowTransaction } from "@/hooks/mutations/useBorrowTransaction";
import { getTokenConfigByAddress } from "@/config/tokens";
import { cidToGatewayUrl } from "@/lib/ipfs";
import { toBigInt } from "@/lib/lendingMath";
import { InterestScheduleChart } from "./InterestScheduleChart";
import {
  formatDurationDays,
  formatTokenAmount,
  formatUsd,
} from "./format";
import type { LendingOffer } from "./types";

interface BorrowConfirmModalProps {
  /** Controls visibility; the modal renders nothing when closed. */
  isOpen: boolean;
  /** The selected lending offer — `null` renders nothing. */
  listing: LendingOffer | null;
  /** Contract address of the collateral token the borrower deposits. */
  collateralCurrency: string;
  /** Exact collateral amount in the token's smallest units. */
  collateralAmount: bigint | number | string;
  /** Called when the user dismisses the modal. */
  onClose: () => void;
  /** Called with the new on-chain position id after a successful borrow. */
  onSuccess?: (positionId: number) => void;
}

export function BorrowConfirmModal({
  isOpen,
  listing,
  collateralCurrency,
  collateralAmount,
  onClose,
  onSuccess,
}: BorrowConfirmModalProps) {
  const { publicKey, isConnected } = useWalletContext();
  const { borrow, isBorrowing, error } = useBorrowTransaction(publicKey);

  // Close on Escape while the dialog is open.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  if (!isOpen || !listing) return null;

  const declaredPriceUsd = toBigInt(listing.declared_price_usd);
  const requiredCollateralUsd =
    (declaredPriceUsd * BigInt(listing.min_collateral_buffer_bps)) / 10_000n;

  const token = getTokenConfigByAddress(collateralCurrency);
  const tokenDecimals = token?.decimals ?? 7;
  const tokenSymbol =
    token?.symbol ?? `${collateralCurrency.slice(0, 4)}...`;

  const displayName =
    listing.nftName?.trim() || `Token #${String(listing.token_id)}`;
  const imageSrc = listing.nftImage
    ? cidToGatewayUrl(listing.nftImage)
    : null;
  const liquidationThresholdPercent = (
    listing.liquidation_threshold_bps / 100
  )
    .toFixed(2)
    .replace(/\.?0+$/, "");

  const handleConfirm = async () => {
    const positionId = await borrow({
      listingId: listing.id,
      collateralCurrency,
      collateralAmount,
    });
    if (positionId !== null) {
      onSuccess?.(positionId);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Confirm borrow transaction"
    >
      <div
        className="absolute inset-0 bg-midnight-950/80 backdrop-blur-sm"
        onClick={onClose}
      />

      <div
        data-testid="borrow-confirm-modal"
        className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-white/10 bg-midnight-900 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start gap-4 border-b border-white/5 p-5">
          <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl bg-midnight-950 ring-1 ring-white/10">
            {imageSrc ? (
              <Image
                src={imageSrc}
                alt={displayName}
                fill
                unoptimized
                sizes="64px"
                className="object-cover"
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center">
                <ImageIcon size={22} className="text-white/20" />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-brand-400">
              Confirm Borrow
            </p>
            <h3
              className="truncate font-display text-lg font-bold text-white"
              title={displayName}
            >
              {displayName}
            </h3>
            <p className="font-mono text-xs text-white/40">
              #{String(listing.token_id)} · {String(listing.id)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-xl bg-white/5 p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* Collateral summary */}
        <div className="space-y-3 p-5">
          <div className="rounded-2xl bg-mint-500/[0.08] border border-mint-500/20 p-4">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-mint-300/70">
              <Coins size={14} />
              Exact collateral required
            </div>
            <p
              data-testid="collateral-exact-amount"
              className="mt-2 font-mono text-2xl font-bold text-mint-400"
            >
              {formatTokenAmount(collateralAmount, tokenDecimals)}{" "}
              {tokenSymbol}
            </p>
            <p className="mt-1 text-xs text-white/50">
              ≈ {formatUsd(requiredCollateralUsd)} —{" "}
              {liquidationThresholdPercent}% liquidation threshold
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-2xl bg-white/[0.02] border border-white/5 p-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-white/40">
                You borrow
              </dt>
              <dd className="mt-1 font-mono font-bold text-white">
                {formatUsd(declaredPriceUsd)}
              </dd>
            </div>
            <div className="rounded-2xl bg-white/[0.02] border border-white/5 p-3">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-white/40">
                Duration
              </dt>
              <dd className="mt-1 flex items-center gap-1.5 font-mono font-bold text-white">
                <Timer size={14} className="text-brand-400" />
                {formatDurationDays(listing.max_duration_days)}
              </dd>
            </div>
          </dl>

          {/* Stepped interest schedule preview */}
          <div className="rounded-2xl bg-white/[0.02] border border-white/5 p-4">
            <p className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/40">
              <Eye size={13} />
              Interest schedule (per month)
            </p>
            <InterestScheduleChart
              schedule={listing.interest_schedule_bps}
              height={140}
            />
          </div>
        </div>

        {/* Liquidation risk warning */}
        <div className="mx-5 mb-4 flex gap-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 p-4">
          <ShieldAlert
            size={20}
            className="mt-0.5 shrink-0 text-amber-400"
          />
          <div className="text-xs text-amber-200/90">
            <p className="flex items-center gap-1.5 font-bold text-amber-300">
              <AlertTriangle size={13} />
              Liquidation Risk
            </p>
            <p className="mt-1 leading-relaxed">
              If the market value of your collateral falls below{" "}
              {liquidationThresholdPercent}% of the amount borrowed, your
              position can be liquidated and you may lose the deposited
              collateral. Keep your health factor healthy and repay early to
              minimise interest. This action cannot be undone once signed.
            </p>
          </div>
        </div>

        {/* Errors from the borrow hook */}
        {error ? (
          <div
            data-testid="borrow-error"
            className="mx-5 mb-4 rounded-2xl bg-red-500/10 border border-red-500/30 p-3 text-xs text-red-300"
          >
            {error}
          </div>
        ) : null}

        {/* Footer actions */}
        <div className="flex flex-col gap-3 border-t border-white/5 p-5">
          {!isConnected && (
            <p className="text-center text-xs text-white/50">
              Connect your wallet to borrow against this NFT.
            </p>
          )}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isBorrowing}
              className="flex-1 rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-sm font-bold text-white/70 transition-all hover:bg-white/10 hover:text-white disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="confirm-borrow"
              onClick={handleConfirm}
              disabled={!isConnected || isBorrowing}
              className="flex flex-[2] items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-terracotta-500 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-brand-500/25 transition-all hover:opacity-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isBorrowing ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Signing transaction...
                </>
              ) : (
                <>
                  <Coins size={16} />
                  Borrow &amp; Deposit Collateral
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}