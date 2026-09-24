"use client";

import React, { useState } from "react";
import type { LendingListing } from "@/lib/lending";

interface BorrowConfirmModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Callback to close the modal */
  onClose: () => void;
  /** The listing being borrowed against */
  listing: LendingListing | null;
  /** Callback to execute the borrow transaction */
  onConfirm: (listing: LendingListing) => Promise<void>;
  /** Whether a transaction is in progress */
  isPending?: boolean;
  /** Current user's token balance */
  userBalance?: bigint;
}

/**
 * Confirmation modal for borrowing against an NFT.
 * Displays collateral requirements, liquidation risks, and executes the borrow.
 */
export function BorrowConfirmModal({
  isOpen,
  onClose,
  listing,
  onConfirm,
  isPending = false,
  userBalance = 0n,
}: BorrowConfirmModalProps) {
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen || !listing) return null;

  // Format amounts (7 decimals for USDC-like tokens)
  const collateralFormatted = Number(listing.collateral_amount) / 10_000_000;
  const priceFormatted = Number(listing.declared_price_usd) / 10_000_000;
  const balanceFormatted = Number(userBalance) / 10_000_000;

  // Calculate liquidation threshold
  const liquidationThreshold = listing.liquidation_threshold_bps / 100;
  const collateralRatio = Number(listing.collateral_amount) / Number(listing.declared_price_usd) * 100;

  // Check if user has sufficient balance
  const hasSufficientBalance = userBalance >= listing.collateral_amount;

  const handleConfirm = async () => {
    if (!agreedToTerms) return;
    setError(null);
    try {
      await onConfirm(listing);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Transaction failed");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative mx-4 w-full max-w-md rounded-2xl border border-white/10 bg-[#0A1324] p-6 shadow-2xl">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">Confirm Borrow</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-gray-400 hover:bg-white/10 hover:text-white"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* NFT Summary */}
        <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white/5">
              <span className="text-2xl">🖼️</span>
            </div>
            <div>
              <p className="text-sm font-medium text-white">
                NFT #{String(listing.token_id)}
              </p>
              <p className="font-mono text-xs text-gray-400">
                {listing.nft_contract.slice(0, 12)}...
              </p>
            </div>
          </div>
        </div>

        {/* Collateral Details */}
        <div className="mb-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">Declared Value</span>
            <span className="font-mono text-sm text-white">
              ${priceFormatted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">Collateral Required</span>
            <span className="font-mono text-sm text-teal-400">
              {collateralFormatted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">Collateral Ratio</span>
            <span className="text-sm text-white">
              {collateralRatio.toFixed(0)}%
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">Liquidation Threshold</span>
            <span className="text-sm text-white">
              {liquidationThreshold.toFixed(0)}%
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">Duration</span>
            <span className="text-sm text-white">
              {listing.max_duration_days} days
            </span>
          </div>
        </div>

        {/* Liquidation Warning */}
        <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
          <div className="flex gap-2">
            <svg className="h-5 w-5 flex-shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <div>
              <p className="text-sm font-medium text-amber-400">Liquidation Risk</p>
              <p className="mt-1 text-xs text-amber-300/80">
                If your collateral value falls below {liquidationThreshold.toFixed(0)}% of the
                loan value, your NFT may be liquidated. You will lose the NFT and
                any collateral deposited.
              </p>
            </div>
          </div>
        </div>

        {/* Balance Check */}
        {!hasSufficientBalance && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
            <div className="flex gap-2">
              <svg className="h-5 w-5 flex-shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div>
                <p className="text-sm font-medium text-red-400">Insufficient Balance</p>
                <p className="mt-1 text-xs text-red-300/80">
                  Your balance: {balanceFormatted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} •
                  Required: {collateralFormatted.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Agreement Checkbox */}
        <label className="mb-4 flex items-start gap-3">
          <input
            type="checkbox"
            checked={agreedToTerms}
            onChange={(e) => setAgreedToTerms(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-gray-600 bg-gray-700 text-teal-500 focus:ring-teal-500"
          />
          <span className="text-xs text-gray-400">
            I understand the liquidation risks and agree to the terms of this
            loan. I confirm I have sufficient collateral to cover the required
            amount.
          </span>
        </label>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={isPending}
            className="flex-1 rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:bg-white/5 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!agreedToTerms || isPending || !hasSufficientBalance}
            className="flex-1 rounded-xl bg-teal-500 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-teal-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isPending ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Processing...
              </span>
            ) : (
              "Confirm Borrow"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
