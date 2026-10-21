// ─────────────────────────────────────────────────────────────
// app/lending/borrow/page.tsx — NFT lending borrow marketplace (#727)
// ─────────────────────────────────────────────────────────────

"use client";

import { useEffect, useRef, useState } from "react";
import { LendingProvider, useLendingContext } from "@/context/LendingContext";
import {
  useActiveListings,
  type IndexedLendingListing,
} from "@/hooks/useActiveListings";
import { useLendingStats } from "@/hooks/useLendingStats";
import { GuardButton } from "@/components/WalletGuard";

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
        <span className="stat-value">
          {isLoading ? "—" : fmt(stats?.tvl ?? 0)}
        </span>
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
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<IndexedLendingListing | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (selected) dialogRef.current?.showModal();
  }, [selected]);

  const { listings, total, isLoading, error, refresh } = useActiveListings({
    page,
    limit: PAGE_SIZE,
    collection: filters.collection,
    currency: filters.tokenType,
  });

  const totalPages = total != null ? Math.ceil(total / PAGE_SIZE) : null;
  const listingName = (listing: IndexedLendingListing) =>
    listing.name || `NFT #${listing.tokenId}`;
  const visibleListings = listings.filter((listing) =>
    listingName(listing).toLowerCase().includes(search.trim().toLowerCase()),
  );

  if (isLoading) {
    return (
      <div
        className="listings-loading"
        role="status"
        aria-label="Loading lending offers"
      >
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="listing-skeleton" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="listings-error" role="alert">
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
      <label htmlFor="borrow-search" className="block mb-2">
        Search listings by name
      </label>
      <input
        id="borrow-search"
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search this page’s lending offers"
        className="w-full mb-6 rounded-xl border border-white/20 bg-midnight-900 px-4 py-3 text-white placeholder:text-white/70"
      />
      {visibleListings.length === 0 && (
        <p role="status">No lending offers match your search.</p>
      )}
      <div className="listings-grid grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {visibleListings.map((listing) => (
          <article
            key={listing.listingId}
            className="listing-card rounded-2xl border border-white/10 bg-midnight-900 p-5"
          >
            <div className="listing-card-header flex items-center justify-between gap-3 mb-4">
              <h2 className="listing-token-id font-semibold">
                {listingName(listing)}
              </h2>
              <span
                className={`listing-status ${String(listing.status).toLowerCase()}`}
              >
                {String(listing.status)}
              </span>
            </div>
            <div className="listing-card-body">
              <p className="listing-price">
                ${Number(listing.declaredPriceUsd) / 1e7}
              </p>
              <p className="listing-seller">
                {listing.lender.slice(0, 6)}…{listing.lender.slice(-4)}
              </p>
              <GuardButton
                type="button"
                onAction={() => setSelected(listing)}
                aria-label={`View loan details for ${listingName(listing)}`}
                className="mt-3 rounded-xl bg-brand-500 px-4 py-2 text-white hover:bg-brand-600"
              >
                View loan details
              </GuardButton>
            </div>
          </article>
        ))}
      </div>

      {totalPages != null && totalPages > 1 && (
        <div className="pagination flex items-center justify-center gap-5 mt-6">
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
      <dialog
        ref={dialogRef}
        aria-labelledby="loan-details-title"
        onClose={() => setSelected(null)}
        className="w-full max-w-lg rounded-2xl border border-white/20 bg-midnight-900 p-6 text-white backdrop:bg-black/70"
      >
        {selected && (
          <>
            <h2 id="loan-details-title" className="text-xl font-bold">
              Loan details: {listingName(selected)}
            </h2>
            <dl className="my-6 space-y-3">
              <div>
                <dt>Collection</dt>
                <dd className="break-all">{selected.nftContract}</dd>
              </div>
              <div>
                <dt>Declared value</dt>
                <dd>${Number(selected.declaredPriceUsd) / 1e7}</dd>
              </div>
              <div>
                <dt>Maximum duration</dt>
                <dd>{selected.maxDurationDays} days</dd>
              </div>
              <div>
                <dt>Monthly interest</dt>
                <dd>
                  {selected.interestScheduleBps
                    .map((rate) => `${rate / 100}%`)
                    .join(", ")}
                </dd>
              </div>
              <div>
                <dt>Minimum collateral</dt>
                <dd>{selected.minCollateralBufferBps / 100}%</dd>
              </div>
            </dl>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="rounded-xl bg-brand-500 px-4 py-2 text-white hover:bg-brand-600"
            >
              Close details
            </button>
          </>
        )}
      </dialog>
    </>
  );
}

// ── Page shell ─────────────────────────────────────────────────

function BorrowPageContent() {
  const { filters } = useLendingContext();
  return (
    <main className="lending-borrow-page">
      <header className="lending-page-header">
        <h1>Borrow against NFTs</h1>
        <p>Browse active lending offers and use your NFTs as collateral.</p>
      </header>

      <StatsBanner />
      <FilterBar />
      <BorrowListingsGrid key={`${filters.collection}-${filters.tokenType}`} />
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
