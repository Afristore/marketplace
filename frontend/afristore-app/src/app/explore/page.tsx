// ─────────────────────────────────────────────────────────────
// app/explore/page.tsx — Browse / Explore All Listings
//
// Full catalogue page with search, filtering, sorting, and
// pagination for discovering marketplace listings at scale.
// ─────────────────────────────────────────────────────────────

"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useMarketplace } from "@/hooks/useMarketplace";
import { Listing, stroopsToXlm } from "@/lib/contract";
import { ListingCard } from "@/components/ListingCard";
import {
  Search,
  SlidersHorizontal,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Package,
  Loader2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { fetchMetadata, ArtworkMetadata } from "@/lib/ipfs";

// ── Types ────────────────────────────────────────────────────

type StatusFilter = "All" | "Active" | "Sold" | "Cancelled";
type SortOption = "newest" | "oldest" | "price-low" | "price-high";

const STATUS_FILTERS: StatusFilter[] = ["All", "Active", "Sold", "Cancelled"];
const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: "newest", label: "Newest First" },
  { value: "oldest", label: "Oldest First" },
  { value: "price-low", label: "Price: Low to High" },
  { value: "price-high", label: "Price: High to Low" },
];

const PAGE_SIZE = 12;

// ── Metadata cache for search ────────────────────────────────

const metadataCache = new Map<string, ArtworkMetadata | null>();

async function getCachedMetadata(
  cid: string
): Promise<ArtworkMetadata | null> {
  if (metadataCache.has(cid)) return metadataCache.get(cid) ?? null;
  try {
    const meta = await fetchMetadata(cid);
    metadataCache.set(cid, meta);
    return meta;
  } catch {
    metadataCache.set(cid, null);
    return null;
  }
}

// ── Page Component ───────────────────────────────────────────

export default function ExplorePage() {
  const { listings, isLoading, error, refresh } = useMarketplace();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("All");
  const [sort, setSort] = useState<SortOption>("newest");
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);

  // Metadata map for search matching (resolved asynchronously)
  const [metadataMap, setMetadataMap] = useState<
    Map<string, ArtworkMetadata | null>
  >(new Map());

  // Resolve metadata for all listings so search can match on title/artist
  useEffect(() => {
    if (listings.length === 0) return;

    let cancelled = false;
    const resolveAll = async () => {
      const entries: [string, ArtworkMetadata | null][] = [];
      await Promise.all(
        listings.map(async (l) => {
          const meta = await getCachedMetadata(l.metadata_cid);
          entries.push([l.metadata_cid, meta]);
        })
      );
      if (!cancelled) {
        setMetadataMap(new Map(entries));
      }
    };
    resolveAll();
    return () => {
      cancelled = true;
    };
  }, [listings]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, sort]);

  // ── Filtering + Sorting ──────────────────────────────────

  const filtered = useMemo(() => {
    let result = [...listings];

    // Status filter
    if (statusFilter !== "All") {
      result = result.filter((l) => l.status === statusFilter);
    }

    // Search (matches title, artist address, or metadata artist name)
    if (search.trim()) {
      const q = search.toLowerCase().trim();
      result = result.filter((l) => {
        if (l.artist.toLowerCase().includes(q)) return true;
        if (l.metadata_cid.toLowerCase().includes(q)) return true;
        const meta = metadataMap.get(l.metadata_cid);
        if (meta?.title?.toLowerCase().includes(q)) return true;
        if (meta?.artist?.toLowerCase().includes(q)) return true;
        if (meta?.description?.toLowerCase().includes(q)) return true;
        return false;
      });
    }

    // Sort
    switch (sort) {
      case "newest":
        result.sort((a, b) => b.created_at - a.created_at);
        break;
      case "oldest":
        result.sort((a, b) => a.created_at - b.created_at);
        break;
      case "price-low":
        result.sort((a, b) => Number(a.price - b.price));
        break;
      case "price-high":
        result.sort((a, b) => Number(b.price - a.price));
        break;
    }

    return result;
  }, [listings, statusFilter, search, sort, metadataMap]);

  // ── Pagination ───────────────────────────────────────────

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginatedListings = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  const goToPage = useCallback(
    (p: number) => {
      setPage(Math.max(1, Math.min(p, totalPages)));
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [totalPages]
  );

  // ── Stats ────────────────────────────────────────────────

  const activeCnt = listings.filter((l) => l.status === "Active").length;
  const soldCnt = listings.filter((l) => l.status === "Sold").length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-midnight-900 pt-24 pb-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <h1 className="text-4xl font-display font-bold text-white">
            Explore Artworks
          </h1>
          <p className="mt-2 text-lg text-white/60">
            Discover and collect unique African art on the blockchain
          </p>

          {/* Stats */}
          <div className="mt-8 flex flex-wrap gap-6">
            {[
              { label: "Total Artworks", value: listings.length },
              { label: "Active Listings", value: activeCnt },
              { label: "Sold", value: soldCnt },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center gap-3">
                <span className="text-2xl font-bold text-brand-400">
                  {value}
                </span>
                <span className="text-sm text-white/50">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="sticky top-16 z-30 border-b border-gray-200 bg-white/95 backdrop-blur-sm shadow-sm">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 py-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
              />
              <input
                type="text"
                placeholder="Search by title, artist, or description..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-10 pr-4 text-sm text-gray-900 placeholder-gray-400 focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-400/20 transition-all"
              />
            </div>

            <div className="flex items-center gap-3">
              {/* Filter toggle (mobile) */}
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="sm:hidden flex items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-gray-600 hover:bg-gray-50"
              >
                <SlidersHorizontal size={14} />
                Filters
              </button>

              {/* Sort */}
              <div className="relative">
                <ArrowUpDown
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
                />
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value as SortOption)}
                  className="appearance-none rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-8 text-sm text-gray-700 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-400/20 cursor-pointer"
                >
                  {SORT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Refresh */}
              <button
                onClick={refresh}
                disabled={isLoading}
                className="rounded-xl border border-gray-200 p-2.5 text-gray-500 hover:bg-gray-50 hover:text-brand-500 disabled:opacity-50 transition-all"
                title="Refresh listings"
              >
                <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
              </button>
            </div>
          </div>

          {/* Status filter tabs */}
          <div
            className={`mt-4 flex flex-wrap gap-2 ${
              showFilters ? "block" : "hidden sm:flex"
            }`}
          >
            {STATUS_FILTERS.map((status) => {
              const isActive = statusFilter === status;
              return (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
                    isActive
                      ? "bg-brand-500 text-white shadow-md shadow-brand-500/20"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {status}
                  {status === "All" && (
                    <span className="ml-1.5 text-xs opacity-70">
                      ({listings.length})
                    </span>
                  )}
                  {status === "Active" && (
                    <span className="ml-1.5 text-xs opacity-70">
                      ({activeCnt})
                    </span>
                  )}
                  {status === "Sold" && (
                    <span className="ml-1.5 text-xs opacity-70">
                      ({soldCnt})
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
        {/* Results count */}
        {!isLoading && !error && (
          <p className="mb-6 text-sm text-gray-500">
            Showing{" "}
            <span className="font-semibold text-gray-700">
              {Math.min((page - 1) * PAGE_SIZE + 1, filtered.length)}
              {" - "}
              {Math.min(page * PAGE_SIZE, filtered.length)}
            </span>{" "}
            of{" "}
            <span className="font-semibold text-gray-700">
              {filtered.length}
            </span>{" "}
            {filtered.length === 1 ? "artwork" : "artworks"}
            {search && (
              <span>
                {" "}
                matching &ldquo;
                <span className="font-medium text-brand-600">{search}</span>
                &rdquo;
              </span>
            )}
          </p>
        )}

        {/* Error state */}
        {error && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 text-red-500 mb-4">
              <AlertCircle size={32} />
            </div>
            <h3 className="font-display font-bold text-gray-900 text-lg">
              Failed to load listings
            </h3>
            <p className="mt-1 text-sm text-gray-500 max-w-sm text-center">
              {error}
            </p>
            <button
              onClick={refresh}
              className="mt-6 flex items-center gap-2 rounded-xl bg-brand-500 px-6 py-2.5 text-sm font-bold text-white hover:bg-brand-600 transition-all"
            >
              <RefreshCw size={14} />
              Try Again
            </button>
          </div>
        )}

        {/* Loading state */}
        {isLoading && !error && (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: PAGE_SIZE }).map((_, i) => (
              <div
                key={i}
                className="animate-pulse rounded-2xl border border-gray-100 bg-white overflow-hidden"
              >
                <div className="aspect-square bg-gray-100" />
                <div className="p-4 space-y-3">
                  <div className="h-4 w-3/4 rounded bg-gray-100" />
                  <div className="h-3 w-1/2 rounded bg-gray-100" />
                  <div className="h-8 w-full rounded-lg bg-gray-100 mt-4" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !error && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-brand-500 mb-4">
              <Package size={32} />
            </div>
            <h3 className="font-display font-bold text-gray-900 text-lg">
              No artworks found
            </h3>
            <p className="mt-1 text-sm text-gray-500 max-w-sm text-center">
              {search
                ? "Try adjusting your search or filters to find what you are looking for."
                : "No listings match the current filters. Check back soon for new artworks."}
            </p>
            {(search || statusFilter !== "All") && (
              <button
                onClick={() => {
                  setSearch("");
                  setStatusFilter("All");
                }}
                className="mt-6 flex items-center gap-2 rounded-xl bg-brand-500 px-6 py-2.5 text-sm font-bold text-white hover:bg-brand-600 transition-all"
              >
                Clear Filters
              </button>
            )}
          </div>
        )}

        {/* Listings grid */}
        {!isLoading && !error && filtered.length > 0 && (
          <>
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {paginatedListings.map((listing: Listing) => (
                <ListingCard
                  key={listing.listing_id}
                  listing={listing}
                  onPurchased={refresh}
                />
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-10 flex items-center justify-center gap-2">
                <button
                  onClick={() => goToPage(page - 1)}
                  disabled={page <= 1}
                  className="flex items-center gap-1 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  <ChevronLeft size={16} />
                  Prev
                </button>

                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => {
                    // Show first, last, and pages near current
                    if (p === 1 || p === totalPages) return true;
                    if (Math.abs(p - page) <= 1) return true;
                    return false;
                  })
                  .reduce<(number | "...")[]>((acc, p, idx, arr) => {
                    if (idx > 0 && p - (arr[idx - 1] as number) > 1) {
                      acc.push("...");
                    }
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((item, idx) =>
                    item === "..." ? (
                      <span
                        key={`dots-${idx}`}
                        className="px-1 text-gray-400"
                      >
                        ...
                      </span>
                    ) : (
                      <button
                        key={item}
                        onClick={() => goToPage(item as number)}
                        className={`min-w-[36px] rounded-xl px-3 py-2 text-sm font-medium transition-all ${
                          page === item
                            ? "bg-brand-500 text-white shadow-md shadow-brand-500/20"
                            : "border border-gray-200 text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        {item}
                      </button>
                    )
                  )}

                <button
                  onClick={() => goToPage(page + 1)}
                  disabled={page >= totalPages}
                  className="flex items-center gap-1 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                  Next
                  <ChevronRight size={16} />
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
