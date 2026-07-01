// ─────────────────────────────────────────────────────────────
// app/explore/page.tsx — Browse / Explore All Listings
//
// Full catalogue page with search, filtering, sorting, and
// pagination for discovering marketplace listings at scale.
// ─────────────────────────────────────────────────────────────

"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { Listing, stroopsToXlm } from "@/lib/contract";
import { ListingCard } from "@/components/ListingCard";
import {
  ChevronLeft,
  ChevronRight,
  Package,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { SearchFilter, Filters, SortOption } from "@/components/SearchFilter";
import { getCachedMetadata, ArtworkMetadata } from "@/lib/ipfs";
import { fetchListings } from "@/lib/indexer";
import { getAllListings } from "@/lib/contract";

// ── Types ────────────────────────────────────────────────────

const PAGE_SIZE = 12;

// ── Page Component ───────────────────────────────────────────

export default function ExplorePage() {
  const [allListings, setAllListings] = useState<Listing[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [filters, setFilters] = useState<Filters>({
    search: "",
    status: "All",
    category: "All",
    minPrice: "",
    maxPrice: "",
    sort: "newest",
  });

  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);

  const [metadataMap, setMetadataMap] = useState<
    Map<string, ArtworkMetadata | null>
  >(new Map());

  // Debounce search so we don't fire on every keystroke
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(
      () => setDebouncedSearch(filters.search),
      350,
    );
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [filters.search]);

  // Fetch from indexer whenever database-filterable params change
  const load = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const opts: Parameters<typeof fetchListings>[0] = { limit: 1000 };
      if (filters.status !== "All") opts.status = filters.status;
      if (filters.minPrice) opts.minPrice = filters.minPrice;
      if (filters.maxPrice) opts.maxPrice = filters.maxPrice;
      if (debouncedSearch.trim()) opts.search = debouncedSearch.trim();

      const res = await fetchListings(opts);
      const rows = Array.isArray(res.listings) ? res.listings : [];
      if (rows.length > 0) {
        setAllListings(rows);
      } else {
        // Fallback to on-chain scan only when indexer response is malformed
        const all = await getAllListings();
        setAllListings(all);
      }
    } catch {
      try {
        const all = await getAllListings();
        setAllListings(all);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load listings");
      }
    } finally {
      setIsLoading(false);
    }
  }, [filters.status, filters.minPrice, filters.maxPrice, debouncedSearch]);

  useEffect(() => {
    load();
  }, [load]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [filters]);

  // Resolve metadata for category / full-text search (client-side only)
  useEffect(() => {
    if (allListings.length === 0) return;
    let cancelled = false;
    const resolveAll = async () => {
      const entries: [string, ArtworkMetadata | null][] = [];
      await Promise.all(
        allListings.map(async (l) => {
          if (!l.metadata_cid) return;
          const meta = await getCachedMetadata(l.metadata_cid);
          entries.push([l.metadata_cid, meta]);
        }),
      );
      if (!cancelled) setMetadataMap(new Map(entries));
    };
    resolveAll();
    return () => {
      cancelled = true;
    };
  }, [allListings]);

  // ── Client-side post-filter for category + sort ───────────

  const filtered = useMemo(() => {
    let result = [...allListings];

    // Category filter (IPFS metadata — client-side only)
    if (filters.category !== "All") {
      result = result.filter((l) => {
        const meta = l.metadata_cid ? metadataMap.get(l.metadata_cid) : null;
        return meta?.category === filters.category;
      });
    }

    // Sort
    switch (filters.sort) {
      case "newest":
        result.sort((a, b) => b.created_at - a.created_at);
        break;
      case "oldest":
        result.sort((a, b) => a.created_at - b.created_at);
        break;
      case "price-low":
        result.sort((a, b) => a.price < b.price ? -1 : a.price > b.price ? 1 : 0);
        break;
      case "price-high":
        result.sort((a, b) => b.price < a.price ? -1 : b.price > a.price ? 1 : 0);
        break;
    }

    return result;
  }, [allListings, filters.category, filters.sort, metadataMap]);

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
    [totalPages],
  );

  // ── Stats ────────────────────────────────────────────────

  const activeCnt = allListings.filter((l) => l.status === "Active").length;
  const soldCnt = allListings.filter((l) => l.status === "Sold").length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-midnight-900 pt-32 pb-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-8">
            <div className="space-y-4">
              <h1 className="text-5xl font-display font-bold text-white tracking-tight">
                Explore Artworks
              </h1>
              <p className="max-w-xl text-xl text-white/60 font-inter leading-relaxed">
                Discover and collect unique African art on the blockchain
              </p>
            </div>

            {/* Stats */}
            <div className="flex flex-wrap gap-8 md:gap-12">
              {[
                { label: "Total Art", value: allListings.length },
                { label: "Active", value: activeCnt },
                { label: "Sold", value: soldCnt },
              ].map(({ label, value }) => (
                <div key={label} className="relative">
                  <span className="text-3xl font-display font-bold text-white block">
                    {value}
                  </span>
                  <span className="text-sm font-bold uppercase tracking-widest text-brand-500">
                    {label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <SearchFilter
        filters={filters}
        onFilterChange={(newFilters) =>
          setFilters((prev) => ({ ...prev, ...newFilters }))
        }
        showFilters={showFilters}
        setShowFilters={setShowFilters}
        totalResults={filtered.length}
      />

      {/* Content */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-12">
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
            {filters.search && (
              <span>
                {" "}
                matching &ldquo;
                <span className="font-medium text-brand-600">
                  {filters.search}
                </span>
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
              onClick={load}
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
              {filters.search
                ? "Try adjusting your search or filters to find what you are looking for."
                : "No listings match the current filters. Check back soon for new artworks."}
            </p>
            {(filters.search ||
              filters.status !== "All" ||
              filters.category !== "All") && (
              <button
                onClick={() => {
                  setFilters({
                    search: "",
                    status: "All",
                    category: "All",
                    minPrice: "",
                    maxPrice: "",
                    sort: "newest",
                  });
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
                  onPurchased={load}
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
                      <span key={`dots-${idx}`} className="px-1 text-gray-400">
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
                    ),
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
