// ─────────────────────────────────────────────────────────────
// components/lending/ActiveListingsGrid.tsx
// ─────────────────────────────────────────────────────────────
// Responsive CSS grid that iterates over active lending
// listings (i.e. the data surfaced by `useActiveListings`)
// and renders an `NFTCollateralCard` for each listing.
// Handles loading and empty states gracefully.
// ─────────────────────────────────────────────────────────────

"use client";

import { useMemo } from "react";
import { Loader2, PackageOpen } from "lucide-react";
import clsx from "clsx";
import type { LendingListing } from "@/lib/lending";

export interface ActiveListingsGridProps {
  /** Active lending listings (Open status) to display. */
  listings: LendingListing[];
  /** Whether the listings data is still loading. */
  isLoading?: boolean;
  /** Optional custom card renderer (defaults to the built-in NFTCollateralCard). */
  renderCard?: (listing: LendingListing) => React.ReactNode;
  /** Grid column sizing strategy. */
  variant?: "compact" | "comfortable";
}

/**
 * Built-in collateral card shown for each listing. Extracted as
 * `NFTCollateralCard` so it can be reused / replaced via `renderCard`.
 */
export function NFTCollateralCard({
  listing,
}: {
  listing: LendingListing;
}) {
  const price = Number(listing.declared_price_usd) / 10_000_000;
  const monthlyRateBps = listing.interest_schedule_bps?.[0] ?? 0;

  return (
    <article
      data-testid="nft-collateral-card"
      className="group flex flex-col overflow-hidden rounded-2xl bg-midnight-900/60 border border-white/5 backdrop-blur-xl transition-transform duration-200 hover:-translate-y-1 hover:border-mint-500/30"
    >
      <div className="relative flex h-36 items-center justify-center bg-gradient-to-br from-midnight-800 to-midnight-900">
        <span className="rounded-lg bg-white/5 px-3 py-1 text-[11px] font-mono text-white/60 ring-1 ring-white/10">
          #{listing.token_id.toString()}
        </span>
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <p
          className="truncate font-mono text-[11px] text-white/40"
          title={listing.nft_contract}
        >
          {listing.nft_contract}
        </p>
        <div className="flex items-baseline justify-between">
          <span className="text-lg font-bold text-white">
            ${price.toLocaleString("en-US", { maximumFractionDigits: 2 })}
          </span>
          <span className="text-xs text-mint-400">
            {(monthlyRateBps / 100).toFixed(2)}% / mo
          </span>
        </div>
        <div className="mt-auto flex items-center justify-between text-[11px] text-white/40">
          <span>Max {listing.max_duration_days} days</span>
          <span
            className={clsx(
              "rounded-full px-2 py-0.5 font-semibold ring-1",
              listing.status === "Open"
                ? "bg-mint-500/15 text-mint-300 ring-mint-500/30"
                : "bg-white/5 text-white/50 ring-white/10",
            )}
          >
            {listing.status}
          </span>
        </div>
      </div>
    </article>
  );
}

export function ActiveListingsGrid({
  listings,
  isLoading = false,
  renderCard,
  variant = "comfortable",
}: ActiveListingsGridProps) {
  const cards = useMemo(
    () =>
      listings.map((listing) => (
        <NFTCollateralCard
          key={`${listing.id}-${listing.nft_contract}-${listing.token_id.toString()}`}
          listing={listing}
        />
      )),
    [listings],
  );

  if (isLoading) {
    return (
      <div
        data-testid="active-listings-loading"
        className="flex items-center justify-center gap-3 py-16 text-white/50"
      >
        <Loader2 size={20} className="animate-spin" />
        <span className="text-sm">Loading active listings…</span>
      </div>
    );
  }

  if (listings.length === 0) {
    return (
      <div
        data-testid="active-listings-empty"
        className="rounded-3xl bg-midnight-900/40 border border-white/5 p-12 text-center"
      >
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-mint-500/10 text-mint-400 mb-4 ring-1 ring-mint-500/20">
          <PackageOpen size={32} />
        </div>
        <h3 className="text-lg font-bold text-white mb-2">
          No active listings found
        </h3>
        <p className="text-sm text-white/50 max-w-md mx-auto">
          There are currently no NFTs available for lending. Check back soon or
          create a listing to get started.
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="active-listings-grid"
      className={clsx(
        "grid gap-4 sm:gap-5",
        variant === "compact"
          ? "grid-cols-2 md:grid-cols-3 xl:grid-cols-4"
          : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
      )}
    >
      {renderCard ? listings.map((l) => renderCard(l)) : cards}
    </div>
  );
}
