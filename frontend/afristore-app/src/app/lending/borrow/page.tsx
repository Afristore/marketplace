// ─────────────────────────────────────────────────────────────
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
