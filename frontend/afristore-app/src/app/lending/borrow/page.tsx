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
// app/lending/borrow/page.tsx — NFT lending borrow marketplace (#727)
// ─────────────────────────────────────────────────────────────

"use client";

import { useState } from "react";
import { LendingProvider, useLendingContext } from "@/context/LendingContext";
import { useActiveListings } from "@/hooks/useActiveListings";
import { useLendingStats } from "@/hooks/useLendingStats";

// ── Stats banner ───────────────────────────────────────────────

function StatsBanner() {
  const { stats, isLoading } = useLendingStats();

  const fmt = (n: number) =>
    n >= 1_000_000
      ? `${(n / 1_000_000).toFixed(2)}M XLM`
      : n >= 1_000
        ? `${(n / 1_000).toFixed(1)}K XLM`
        : `${n} XLM`;

  return (
    <div className="lending-stats-banner">
      <div className="stat-item">
        <span className="stat-label">TVL</span>
        <span className="stat-value">{isLoading ? "—" : fmt(stats?.tvl ?? 0)}</span>
      </div>
      <div className="stat-item">
        <span className="stat-label">24h Volume</span>
        <span className="stat-value">
          {isLoading ? "—" : fmt(stats?.volume24h ?? 0)}
        </span>
      </div>
      <div className="stat-item">
        <span className="stat-label">Active Loans</span>
        <span className="stat-value">
          {isLoading ? "—" : (stats?.activeLoans ?? 0).toLocaleString()}
        </span>
      </div>
    </div>
  );
}

// ── Filters ────────────────────────────────────────────────────

const COLLECTIONS = ["All", "Stellar Punks", "Lumens Apes", "Cosmo Cats"];
const TOKEN_TYPES = ["All", "XLM", "USDC", "yXLM"];

function FilterBar() {
  const { filters, setFilter, resetFilters } = useLendingContext();

  const handleCollection = (c: string) =>
    setFilter({ collection: c === "All" ? null : c });

  const handleToken = (t: string) =>
    setFilter({ tokenType: t === "All" ? null : t });

  const hasFilters = filters.collection !== null || filters.tokenType !== null;

  return (
    <div className="lending-filter-bar">
      <div className="filter-group">
        <label className="filter-label">Collection</label>
        <div className="filter-pills">
          {COLLECTIONS.map((c) => (
            <button
              key={c}
              className={`filter-pill${filters.collection === (c === "All" ? null : c) ? " active" : ""}`}
              onClick={() => handleCollection(c)}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-group">
        <label className="filter-label">Token Type</label>
        <div className="filter-pills">
          {TOKEN_TYPES.map((t) => (
            <button
              key={t}
              className={`filter-pill${filters.tokenType === (t === "All" ? null : t) ? " active" : ""}`}
              onClick={() => handleToken(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {hasFilters && (
        <button className="filter-reset" onClick={resetFilters}>
          Clear filters
        </button>
      )}
    </div>
  );
}

// ── Listings grid ──────────────────────────────────────────────

const PAGE_SIZE = 20;

function BorrowListingsGrid() {
  const { filters } = useLendingContext();
  const [page, setPage] = useState(0);

  const { listings, total, isLoading, error, refresh } = useActiveListings({
    page,
    limit: PAGE_SIZE,
    collection: filters.collection,
    currency: filters.tokenType,
  });

  const totalPages = total != null ? Math.ceil(total / PAGE_SIZE) : null;

  if (isLoading) {
    return (
      <div className="listings-loading">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="listing-skeleton" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="listings-error">
        <p>{error}</p>
        <button onClick={refresh}>Retry</button>
      </div>
    );
  }

  if (listings.length === 0) {
    return (
      <div className="listings-empty">
        <p>No active lending offers found.</p>
        {(filters.collection || filters.tokenType) && (
          <p>Try adjusting your filters.</p>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="listings-grid">
        {listings.map((listing) => (
          <div key={`${listing.owner}-${listing.token_id}`} className="listing-card">
            <div className="listing-card-header">
              <span className="listing-token-id">#{listing.token_id}</span>
              <span className={`listing-status ${String(listing.status).toLowerCase()}`}>
                {String(listing.status)}
              </span>
            </div>
            <div className="listing-card-body">
              <p className="listing-price">
                {listing.price ? `${Number(listing.price) / 1e7} XLM` : "—"}
              </p>
              <p className="listing-seller">
                {String(listing.owner || "").slice(0, 6)}…{String(listing.owner || "").slice(-4)}
              </p>
            </div>
          </div>
        ))}
      </div>

      {totalPages != null && totalPages > 1 && (
        <div className="pagination">
          <button
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            ← Prev
          </button>
          <span>
            Page {page + 1} / {totalPages}
          </span>
          <button
            disabled={page + 1 >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next →
          </button>
        </div>
      )}
    </>
  );
}

// ── Page shell ─────────────────────────────────────────────────

function BorrowPageContent() {
  return (
    <main className="lending-borrow-page">
      <header className="lending-page-header">
        <h1>Borrow against NFTs</h1>
        <p>Browse active lending offers and use your NFTs as collateral.</p>
      </header>

      <StatsBanner />
      <FilterBar />
      <BorrowListingsGrid />
    </main>
  );
}

export default function BorrowPage() {
  return (
    <LendingProvider>
      <BorrowPageContent />
    </LendingProvider>
  );
}
