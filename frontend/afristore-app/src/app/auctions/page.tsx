// ─────────────────────────────────────────────────────────────
// app/auctions/page.tsx — Auction Browse Page
// ─────────────────────────────────────────────────────────────

"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { useAuctions } from "@/hooks/useAuctions";
import { Auction, stroopsToXlm } from "@/lib/contract";
import { fetchMetadata, cidToGatewayUrl, ArtworkMetadata } from "@/lib/ipfs";
import {
  Gavel,
  Clock,
  Trophy,
  Package,
  RefreshCw,
  AlertCircle,
} from "lucide-react";

type Tab = "all" | "Active" | "Finalized" | "Cancelled";

const STATUS_COLOR: Record<string, string> = {
  Active: "text-green-600 bg-green-50",
  Finalized: "text-blue-600 bg-blue-50",
  Cancelled: "text-gray-500 bg-gray-100",
};

const TABS: { key: Tab; label: string }[] = [
  { key: "all", label: "All" },
  { key: "Active", label: "Active" },
  { key: "Finalized", label: "Finalized" },
  { key: "Cancelled", label: "Cancelled" },
];

// ── Metadata cache ──────────────────────────────────────────

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

// ── Countdown helper ────────────────────────────────────────

function TimeRemaining({ endTime }: { endTime: number }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const remaining = Math.max(0, endTime - now);
  if (remaining <= 0)
    return <span className="text-red-500 font-semibold">Expired</span>;

  const d = Math.floor(remaining / 86400);
  const h = Math.floor((remaining % 86400) / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;

  return (
    <span className="font-mono text-xs text-gray-600">
      {d > 0 && `${d}d `}
      {String(h).padStart(2, "0")}:{String(m).padStart(2, "0")}:
      {String(s).padStart(2, "0")}
    </span>
  );
}

// ── Auction Card ────────────────────────────────────────────

function AuctionCard({ auction }: { auction: Auction }) {
  const [metadata, setMetadata] = useState<ArtworkMetadata | null>(null);

  useEffect(() => {
    getCachedMetadata(auction.metadata_cid).then(setMetadata);
  }, [auction.metadata_cid]);

  const imageUrl = metadata?.image ? cidToGatewayUrl(metadata.image) : null;
  const currentBidXlm = Number(auction.highest_bid) / 10_000_000;

  return (
    <Link
      href={`/auctions/${auction.auction_id}`}
      className="group rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden hover:shadow-md hover:-translate-y-1 transition-all duration-300"
    >
      {/* Image */}
      <div className="relative aspect-square bg-brand-50">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={metadata?.title ?? "Auction artwork"}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-500"
            unoptimized
          />
        ) : (
          <div className="flex h-full items-center justify-center text-5xl text-brand-300">
            <Gavel size={48} />
          </div>
        )}

        {/* Status badge */}
        <span
          className={`absolute top-3 right-3 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
            STATUS_COLOR[auction.status] ?? ""
          }`}
        >
          {auction.status}
        </span>
      </div>

      {/* Info */}
      <div className="p-4 space-y-2">
        <h3 className="font-display font-bold text-gray-900 truncate">
          {metadata?.title ?? `Auction #${auction.auction_id}`}
        </h3>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Trophy size={13} className="text-brand-500" />
            <span className="text-sm font-semibold text-gray-800">
              {currentBidXlm > 0
                ? `${stroopsToXlm(auction.highest_bid)} XLM`
                : "No bids"}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Clock size={12} className="text-gray-400" />
            <TimeRemaining endTime={auction.end_time} />
          </div>
        </div>

        <p className="text-xs text-gray-400">
          Reserve: {stroopsToXlm(auction.reserve_price)} XLM
        </p>
      </div>
    </Link>
  );
}

// ── Page ────────────────────────────────────────────────────

export default function AuctionsPage() {
  const { auctions, isLoading, error, refresh } = useAuctions();
  const [tab, setTab] = useState<Tab>("all");

  const [metadataMap, setMetadataMap] = useState<
    Map<string, ArtworkMetadata | null>
  >(new Map());

  // Resolve metadata for all auctions
  useEffect(() => {
    if (auctions.length === 0) return;
    let cancelled = false;
    const resolveAll = async () => {
      const entries: [string, ArtworkMetadata | null][] = [];
      await Promise.all(
        auctions.map(async (a) => {
          const meta = await getCachedMetadata(a.metadata_cid);
          entries.push([a.metadata_cid, meta]);
        })
      );
      if (!cancelled) setMetadataMap(new Map(entries));
    };
    resolveAll();
    return () => {
      cancelled = true;
    };
  }, [auctions]);

  const filtered = useMemo(() => {
    const list =
      tab === "all" ? auctions : auctions.filter((a) => a.status === tab);
    return [...list].sort((a, b) => b.end_time - a.end_time);
  }, [auctions, tab]);

  const activeCnt = auctions.filter((a) => a.status === "Active").length;
  const finalizedCnt = auctions.filter((a) => a.status === "Finalized").length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-midnight-900 pt-24 pb-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <h1 className="text-4xl font-display font-bold text-white">
            Auctions
          </h1>
          <p className="mt-2 text-lg text-white/60">
            Bid on unique African artworks
          </p>

          {/* Stats */}
          <div className="mt-8 flex flex-wrap gap-6">
            {[
              { label: "Total Auctions", value: auctions.length },
              { label: "Active", value: activeCnt },
              { label: "Finalized", value: finalizedCnt },
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
          <div className="flex items-center justify-between">
            <div className="flex flex-wrap gap-2">
              {TABS.map(({ key, label }) => {
                const isActive = tab === key;
                return (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
                      isActive
                        ? "bg-brand-500 text-white shadow-md shadow-brand-500/20"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {label}
                    {key === "all" && (
                      <span className="ml-1.5 text-xs opacity-70">
                        ({auctions.length})
                      </span>
                    )}
                    {key === "Active" && (
                      <span className="ml-1.5 text-xs opacity-70">
                        ({activeCnt})
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <button
              onClick={refresh}
              disabled={isLoading}
              className="rounded-xl border border-gray-200 p-2.5 text-gray-500 hover:bg-gray-50 hover:text-brand-500 disabled:opacity-50 transition-all"
              title="Refresh auctions"
            >
              <RefreshCw
                size={16}
                className={isLoading ? "animate-spin" : ""}
              />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-8">
        {/* Error state */}
        {error && (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 text-red-500 mb-4">
              <AlertCircle size={32} />
            </div>
            <h3 className="font-display font-bold text-gray-900 text-lg">
              Failed to load auctions
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

        {/* Loading skeletons */}
        {isLoading && !error && (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="animate-pulse rounded-2xl border border-gray-100 bg-white overflow-hidden"
              >
                <div className="aspect-square bg-gray-100" />
                <div className="p-4 space-y-3">
                  <div className="h-4 w-3/4 rounded bg-gray-100" />
                  <div className="h-3 w-1/2 rounded bg-gray-100" />
                  <div className="h-3 w-1/3 rounded bg-gray-100" />
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
              No auctions found
            </h3>
            <p className="mt-1 text-sm text-gray-500 max-w-sm text-center">
              {tab === "all"
                ? "No auctions have been created yet. Check back soon!"
                : `No ${tab.toLowerCase()} auctions at the moment.`}
            </p>
            {tab !== "all" && (
              <button
                onClick={() => setTab("all")}
                className="mt-6 flex items-center gap-2 rounded-xl bg-brand-500 px-6 py-2.5 text-sm font-bold text-white hover:bg-brand-600 transition-all"
              >
                View All Auctions
              </button>
            )}
          </div>
        )}

        {/* Auction grid */}
        {!isLoading && !error && filtered.length > 0 && (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((auction) => (
              <AuctionCard key={auction.auction_id} auction={auction} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
