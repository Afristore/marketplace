// ─────────────────────────────────────────────────────────────
// app/lending/borrow/page.tsx — Borrow flow
// ─────────────────────────────────────────────────────────────
// Shows open lending offers as NFTCollateralCard grids and lets
// the borrower confirm a borrow transaction through
// BorrowConfirmModal (which executes via useBorrowTransaction).
//──────────────────────────────────────────────────────────────

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Landmark,
  Loader2,
  PackageOpen,
  RefreshCw,
} from "lucide-react";
import { useSupportedTokens } from "@/hooks/useSupportedTokens";
import { useLendingListings } from "@/hooks/useLendingListings";
import { NFTCollateralCard } from "@/components/lending/NFTCollateralCard";
import { BorrowConfirmModal } from "@/components/lending/BorrowConfirmModal";
import {
  DEFAULT_TOKEN,
  getTokenConfigByAddress,
} from "@/config/tokens";
import { toBigInt } from "@/lib/lendingMath";
import type { LendingOffer } from "@/components/lending/types";

export default function BorrowPage() {
  const { listings, isLoading, error, refresh } = useLendingListings();
  const { tokens } = useSupportedTokens();

  const [selectedOffer, setSelectedOffer] = useState<LendingOffer | null>(
    null,
  );
  const [collateralCurrency, setCollateralCurrency] = useState<string>(
    () => DEFAULT_TOKEN.address,
  );

  /**
   * Raw collateral amount (smallest token units) required to borrow
   * against the selected offer. Collateral is USD-denominated on-chain,
   * so we convert the USD requirement at the token's decimal scale.
   */
  const collateralAmount = useMemo(() => {
    if (!selectedOffer) return 0n;
    const token = getTokenConfigByAddress(collateralCurrency);
    const decimals = token?.decimals ?? 7;
    const declared = toBigInt(selectedOffer.declared_price_usd);
    const requiredUsd =
      (declared * BigInt(selectedOffer.min_collateral_buffer_bps)) /
      10_000n;
    return requiredUsd * 10n ** BigInt(decimals);
  }, [selectedOffer, collateralCurrency]);

  return (
    <div className="space-y-8">
      <div className="rounded-3xl bg-midnight-900/60 border border-white/5 p-6 sm:p-8 backdrop-blur-xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold font-display text-white">
              Borrow Liquidity Against NFTs
            </h2>
            <p className="text-sm text-white/60 mt-1 max-w-2xl">
              Browse open listings created by lenders. Deposit collateral in
              whitelisted Stellar tokens (e.g. USDC, XLM) to borrow African
              art NFTs for exhibitions, staking yield, or commercial display.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={isLoading}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-white/5 border border-white/10 px-4 py-2 text-xs font-semibold text-white/80 transition-all hover:bg-white/10 hover:text-white disabled:opacity-50 self-start sm:self-auto"
          >
            <RefreshCw size={14} className={isLoading ? "animate-spin" : ""} />
            Refresh Listings
          </button>
        </div>

        {/* Collateral token selection */}
        {tokens.length > 0 && (
          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-white/5 pt-5">
            <label
              htmlFor="collateral-token"
              className="text-xs font-bold uppercase tracking-wider text-white/50"
            >
              Collateral Token
            </label>
            <select
              id="collateral-token"
              value={collateralCurrency}
              onChange={(e) => setCollateralCurrency(e.target.value)}
              className="rounded-xl border border-white/10 bg-midnight-950 px-3 py-2 text-xs font-mono font-semibold text-white/80 focus:border-brand-500/50 focus:outline-none"
            >
              {tokens.map((token) => (
                <option key={token.address} value={token.address}>
                  {token.symbol} — {token.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Listings */}
      {isLoading && listings.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-3xl bg-midnight-900/40 border border-white/5 p-16 text-center">
          <Loader2 size={40} className="animate-spin text-brand-500 mb-4" />
          <p className="text-sm text-white/60">
            Loading available lending offers...
          </p>
        </div>
      ) : error && listings.length === 0 ? (
        <div className="rounded-3xl bg-red-500/10 border border-red-500/20 p-8 text-center">
          <p className="text-sm text-red-300">{error}</p>
          <button
            type="button"
            onClick={() => void refresh()}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-4 py-2 text-xs font-semibold text-white/80 hover:bg-white/10"
          >
            <RefreshCw size={14} />
            Try again
          </button>
        </div>
      ) : listings.length === 0 ? (
        <div className="rounded-3xl bg-midnight-900/40 border border-white/5 p-12 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-400 mb-4 ring-1 ring-brand-500/20">
            <PackageOpen size={32} />
          </div>
          <h3 className="text-lg font-bold text-white mb-2">
            No open lending offers
          </h3>
          <p className="text-sm text-white/50 max-w-md mx-auto mb-6">
            Lenders have not listed any NFTs for borrowing yet. Check back soon
            or list your own NFT to earn interest.
          </p>
          <Link
            href="/lending/lend"
            className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-terracotta-500 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-brand-500/25 hover:opacity-95 transition-all"
          >
            <Landmark size={16} />
            <span>Switch to Lender Flow</span>
            <ArrowRight size={16} />
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {listings.map((offer) => (
            <NFTCollateralCard
              key={String(offer.id)}
              listing={offer}
              onBorrow={(l) => setSelectedOffer(l)}
            />
          ))}
        </div>
      )}

      {/* Confirm borrow */}
      <BorrowConfirmModal
        isOpen={selectedOffer !== null}
        listing={selectedOffer}
        collateralCurrency={collateralCurrency}
        collateralAmount={collateralAmount}
        onClose={() => setSelectedOffer(null)}
        onSuccess={() => {
          setSelectedOffer(null);
          void refresh();
        }}
      />
    </div>
  );
}
