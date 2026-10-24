// ─────────────────────────────────────────────────────────────
// components/FeaturedListings.tsx — Featured artworks carousel
// ─────────────────────────────────────────────────────────────

"use client";

import { useState, useEffect, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { useMarketplace } from "@/hooks/useMarketplace";
import { Listing, stroopsToXlm } from "@/lib/contract";
import { fetchMetadata, cidToGatewayUrl, ArtworkMetadata } from "@/lib/ipfs";
import {
  AlertCircle,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Tag,
  Eye,
  X,
} from "lucide-react";

interface EnrichedItem {
  listing: Listing;
  metadata: ArtworkMetadata | null;
  imageUrl: string;
}

function getDesktopCardWidthClass(itemCount: number): string {
  if (itemCount <= 1) {
    return "md:min-w-full md:max-w-full";
  }

  if (itemCount === 2) {
    return "md:min-w-[calc(50%-12px)] md:max-w-[calc(50%-12px)]";
  }

  return "md:min-w-[calc(33.333%-16px)] md:max-w-[calc(33.333%-16px)]";
}

export function FeaturedListings() {
  const { listings, isLoading, error: marketplaceError } = useMarketplace();
  const [enriched, setEnriched] = useState<EnrichedItem[]>([]);
  const [scrollIdx, setScrollIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const activeListings = listings
    .filter((listing: Listing) => listing.status === "Active")
    .slice(0, 6);

  useEffect(() => {
    if (marketplaceError) {
      setError(marketplaceError);
    }
  }, [marketplaceError]);

  useEffect(() => {
    let cancelled = false;
    const active = listings
      .filter((listing: Listing) => listing.status === "Active")
      .slice(0, 6);

    setEnriched([]);
    setScrollIdx(0);

    if (active.length === 0) {
      return () => {
        cancelled = true;
      };
    }

    const enrichListings = async () => {
      try {
        const items = await Promise.all(
          active.map(async (listing) => {
            try {
              const meta = await fetchMetadata(listing.metadata_cid);
              return {
                listing,
                metadata: meta,
                imageUrl: meta?.image
                  ? cidToGatewayUrl(meta.image)
                  : "/placeholder-art.svg",
              };
            } catch {
              return {
                listing,
                metadata: null,
                imageUrl: "/placeholder-art.svg",
              };
            }
          }),
        );
        if (!cancelled) {
          setEnriched(items);
          // Clear enrichment-only errors once listings resolve successfully.
          if (!marketplaceError) setError(null);
        }
      } catch (err: unknown) {
        console.error("Featured listings enrichment failed:", err);
        if (!cancelled) {
          const message =
            err instanceof Error
              ? err.message
              : "Failed to load featured artworks. Please try again.";
          setError(message);
        }
      }
    };

    void enrichListings();

    return () => {
      cancelled = true;
    };
  }, [listings, marketplaceError]);

  const liveFallbackItems: EnrichedItem[] = activeListings.map((listing) => ({
    listing,
    metadata: null,
    imageUrl: "/placeholder-art.svg",
  }));
  const displayItems = enriched.length > 0 ? enriched : liveFallbackItems;
  const hasListings = activeListings.length > 0;
  const itemCount = displayItems.length;
  const maxScroll = Math.max(0, itemCount - 3);
  const desktopCardWidthClass = getDesktopCardWidthClass(itemCount);
  const showEmptyState = !isLoading && !hasListings;

  const scrollNext = useCallback(() => {
    try {
      setScrollIdx((prev) => Math.min(prev + 1, maxScroll));
    } catch (err: unknown) {
      console.error("Featured listings scroll next failed:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to navigate featured artworks.",
      );
    }
  }, [maxScroll]);

  const scrollPrev = useCallback(() => {
    try {
      setScrollIdx((prev) => Math.max(prev - 1, 0));
    } catch (err: unknown) {
      console.error("Featured listings scroll prev failed:", err);
      setError(
        err instanceof Error
          ? err.message
          : "Failed to navigate featured artworks.",
      );
    }
  }, []);

  return (
    <section className="relative py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="mb-12 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="mb-3 text-sm font-semibold uppercase tracking-widest text-brand-500">
              ✦ Curated Collection
            </p>
            <h2 className="font-display text-3xl font-bold text-midnight-900 sm:text-4xl lg:text-5xl">
              Featured <span className="text-brand-500">Artworks</span>
            </h2>
            <p className="mt-3 max-w-lg text-base text-gray-500">
              Fresh listings from across the continent appear here as soon as
              artists publish them.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={scrollPrev}
              disabled={scrollIdx === 0 || showEmptyState}
              aria-label="Previous featured artworks"
              className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-brand-200 text-brand-600 transition-all duration-300 hover:border-brand-500 hover:bg-brand-500 hover:text-white disabled:opacity-30 disabled:hover:border-brand-200 disabled:hover:bg-transparent disabled:hover:text-brand-600"
            >
              <ChevronLeft size={20} />
            </button>
            <button
              onClick={scrollNext}
              disabled={scrollIdx >= maxScroll || showEmptyState}
              aria-label="Next featured artworks"
              className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-brand-200 text-brand-600 transition-all duration-300 hover:border-brand-500 hover:bg-brand-500 hover:text-white disabled:opacity-30 disabled:hover:border-brand-200 disabled:hover:bg-transparent disabled:hover:text-brand-600"
            >
              <ChevronRight size={20} />
            </button>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-6 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
          >
            <div className="flex items-center gap-2">
              <AlertCircle size={16} className="flex-shrink-0 text-red-500" />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => setError(null)}
              className="ml-2 text-red-500 transition-colors hover:text-red-700"
              aria-label="Dismiss error"
            >
              <X size={16} />
            </button>
          </div>
        )}

        {showEmptyState ? (
          <div className="rounded-3xl border border-brand-100 bg-white px-6 py-12 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-brand-500">
              <Tag size={24} />
            </div>
            <h3 className="font-display text-2xl font-bold text-midnight-900">
              No live featured listings yet
            </h3>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-gray-500 sm:text-base">
              The homepage will highlight live inventory as soon as artists
              publish active listings. Nothing is being padded with sample
              artwork.
            </p>
          </div>
        ) : (
          <>
            <div className="hidden overflow-hidden md:block">
              <div
                className="flex gap-6 transition-transform duration-500 ease-out"
                style={{
                  transform: `translateX(-${scrollIdx * (100 / 3 + 1.5)}%)`,
                }}
              >
                {displayItems.map((item, i) => (
                  <div
                    key={item.listing.listing_id}
                    className={`min-w-full max-w-full flex-shrink-0 group relative ${desktopCardWidthClass}`}
                    style={{ animationDelay: `${i * 150}ms` }}
                  >
                    <Link href={`/listings/${item.listing.listing_id}`}>
                      <div className="relative aspect-[4/5] overflow-hidden rounded-2xl corner-accent">
                        <Image
                          src={item.imageUrl}
                          alt={
                            item.metadata?.title ??
                            `Artwork #${item.listing.listing_id}`
                          }
                          fill
                          className="object-cover transition-transform duration-700 group-hover:scale-110"
                          unoptimized
                        />
                        <div className="absolute inset-0 bg-card-gradient opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

                        <div className="absolute bottom-0 left-0 right-0 translate-y-4 p-5 opacity-0 transition-all duration-500 group-hover:translate-y-0 group-hover:opacity-100">
                          <h3 className="font-display text-lg font-bold text-white">
                            {item.metadata?.title ??
                              `Artwork #${item.listing.listing_id}`}
                          </h3>
                          <p className="mt-1 text-sm text-brand-200">
                            {item.metadata?.artist ?? "Unknown Artist"}
                          </p>
                          <div className="mt-3 flex items-center justify-between">
                            <div className="flex items-center gap-1.5 text-brand-400">
                              <Tag size={14} />
                              <span className="font-bold text-white">
                                {stroopsToXlm(item.listing.price)} XLM
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 text-sm text-white/70">
                              <Eye size={14} />
                              View
                            </div>
                          </div>
                        </div>

                        <span className="absolute right-4 top-4 rounded-full bg-mint-500/90 px-3 py-1 text-xs font-semibold text-white backdrop-blur-sm">
                          {item.listing.status}
                        </span>
                      </div>
                    </Link>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 md:hidden">
              {displayItems.slice(0, 4).map((item) => (
                <Link
                  key={item.listing.listing_id}
                  href={`/listings/${item.listing.listing_id}`}
                  className="group relative aspect-[4/5] overflow-hidden rounded-2xl"
                >
                  <Image
                    src={item.imageUrl}
                    alt={
                      item.metadata?.title ??
                      `Artwork #${item.listing.listing_id}`
                    }
                    fill
                    className="object-cover"
                    unoptimized
                  />
                  <div className="absolute inset-0 bg-card-gradient" />
                  <div className="absolute bottom-0 left-0 right-0 p-4">
                    <h3 className="font-display font-bold text-white">
                      {item.metadata?.title ??
                        `Artwork #${item.listing.listing_id}`}
                    </h3>
                    <p className="text-sm text-brand-300">
                      {item.metadata?.artist ?? "Unknown Artist"}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}

        <div className="mt-12 text-center">
          <Link
            href="/explore"
            className="group/link inline-flex items-center gap-2 font-semibold text-brand-600 transition-colors hover:text-brand-700"
          >
            View All Artworks
            <ArrowRight
              size={18}
              className="transition-transform group-hover/link:translate-x-1"
            />
          </Link>
        </div>
      </div>
    </section>
  );
}
