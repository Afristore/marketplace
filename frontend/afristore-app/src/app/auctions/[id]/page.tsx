// ─────────────────────────────────────────────────────────────
// app/auctions/[id]/page.tsx — Auction detail page
// ─────────────────────────────────────────────────────────────

"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { getAuction, stroopsToXlm, Auction } from "@/lib/contract";
import { fetchMetadata, cidToGatewayUrl, ArtworkMetadata } from "@/lib/ipfs";
import { getListingActivity, ActivityEvent } from "@/lib/indexer";
import { getReadableErrorMessage } from "@/lib/errors";
import { useWalletContext } from "@/context/WalletContext";
import { usePlaceBid, useFinalizeAuction } from "@/hooks/useAuctions";
import { GuardButton } from "@/components/WalletGuard";
import {
  ArrowLeft,
  Clock,
  Gavel,
  Trophy,
  History,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  User,
  Calendar,
  Tag,
  Hash,
  Hammer,
  Flag,
} from "lucide-react";

// ── Countdown component ──────────────────────────────────────

function Countdown({ endTime }: { endTime: number }) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = Math.max(0, endTime - now);

  if (remaining === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-3 py-1 text-sm font-semibold text-red-600">
        <Flag size={13} />
        Auction Ended
      </span>
    );
  }

  const d = Math.floor(remaining / 86400);
  const h = Math.floor((remaining % 86400) / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = remaining % 60;

  return (
    <div className="flex items-center gap-3">
      {(
        [
          { label: "Days", value: d },
          { label: "Hours", value: h },
          { label: "Min", value: m },
          { label: "Sec", value: s },
        ] as const
      ).map(({ label, value }) => (
        <div
          key={label}
          className="flex flex-col items-center rounded-xl bg-brand-50 px-3 py-2 min-w-[52px]"
        >
          <span className="font-mono text-2xl font-bold text-brand-700 leading-none">
            {String(value).padStart(2, "0")}
          </span>
          <span className="mt-1 text-[10px] uppercase tracking-wide text-brand-400">
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Bid history row ──────────────────────────────────────────

function BidHistoryRow({ event }: { event: ActivityEvent }) {
  const amountXlm = (Number(event.price) / 10_000_000).toLocaleString(
    undefined,
    { maximumFractionDigits: 4 }
  );
  const shortAddr = (addr: string) =>
    addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;

  return (
    <div className="flex items-center justify-between rounded-xl border border-gray-100 bg-white px-4 py-3 text-sm">
      <div className="flex items-center gap-2 text-gray-700 min-w-0">
        <User size={13} className="shrink-0 text-gray-400" />
        <span className="truncate font-mono text-xs">
          {shortAddr(event.from)}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <span className="font-semibold text-brand-600">{amountXlm} XLM</span>
        <span className="text-xs text-gray-400">
          Ledger {event.tx_hash.replace("ledger_", "")}
        </span>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────

export default function AuctionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { publicKey } = useWalletContext();

  const [auction, setAuction] = useState<Auction | null>(null);
  const [metadata, setMetadata] = useState<ArtworkMetadata | null>(null);
  const [bidHistory, setBidHistory] = useState<ActivityEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"details" | "bids">("details");

  const [bidAmountXlm, setBidAmountXlm] = useState("");
  const [bidSuccess, setBidSuccess] = useState(false);
  const [finalizeSuccess, setFinalizeSuccess] = useState(false);

  const { bid, isBidding, error: bidError } = usePlaceBid(publicKey);
  const { finalize, isFinalizing, error: finalizeError } =
    useFinalizeAuction(publicKey);

  const loadData = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    setError(null);
    try {
      const auctionData = await getAuction(Number(id));
      setAuction(auctionData);

      const [meta, history] = await Promise.all([
        fetchMetadata(auctionData.metadata_cid).catch(() => null),
        getListingActivity(Number(id)).catch(() => [] as ActivityEvent[]),
      ]);
      setMetadata(meta);
      setBidHistory(history);
    } catch (err) {
      setError(getReadableErrorMessage(err, "Failed to load auction"));
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleBid = async () => {
    if (!auction) return;
    const amountXlm = parseFloat(bidAmountXlm);
    if (!amountXlm || amountXlm <= 0) return;
    const ok = await bid(auction.auction_id, amountXlm);
    if (ok) {
      setBidSuccess(true);
      setBidAmountXlm("");
      setTimeout(() => setBidSuccess(false), 3000);
      loadData();
    }
  };

  const handleFinalize = async () => {
    if (!auction) return;
    const ok = await finalize(auction.auction_id);
    if (ok) {
      setFinalizeSuccess(true);
      loadData();
    }
  };

  const now = Math.floor(Date.now() / 1000);
  const isExpired = auction ? now >= auction.end_time : false;
  const isActive = auction?.status === "Active";
  const isFinalized = auction?.status === "Finalized";
  const isCancelled = auction?.status === "Cancelled";
  const canFinalize = isActive && isExpired;
  const canBid = isActive && !isExpired;

  const imageUrl = metadata?.image ? cidToGatewayUrl(metadata.image) : null;
  const highestBidXlm = auction ? stroopsToXlm(auction.highest_bid) : "0";
  const reserveXlm = auction ? stroopsToXlm(auction.reserve_price) : "0";

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 pt-24">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="animate-pulse grid gap-8 lg:grid-cols-2">
            <div className="aspect-square rounded-3xl bg-gray-200" />
            <div className="space-y-4 pt-4">
              <div className="h-8 w-3/4 rounded-xl bg-gray-200" />
              <div className="h-5 w-1/2 rounded-xl bg-gray-200" />
              <div className="h-24 rounded-2xl bg-gray-200" />
              <div className="h-12 rounded-2xl bg-gray-200" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error || !auction) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-gray-50 pt-24">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 text-red-500">
          <AlertCircle size={32} />
        </div>
        <h2 className="text-lg font-bold text-gray-900">
          {error ?? "Auction not found"}
        </h2>
        <button
          onClick={() => router.push("/auctions")}
          className="flex items-center gap-2 rounded-xl bg-brand-500 px-6 py-2.5 text-sm font-bold text-white hover:bg-brand-600 transition-all"
        >
          <ArrowLeft size={14} />
          Back to Auctions
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Back nav */}
      <div className="pt-20 pb-4">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <Link
            href="/auctions"
            className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-brand-600 transition-colors"
          >
            <ArrowLeft size={14} />
            All Auctions
          </Link>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-4 sm:px-6 pb-16">
        <div className="grid gap-10 lg:grid-cols-[1fr_420px]">
          {/* Artwork image */}
          <div className="relative aspect-square overflow-hidden rounded-3xl bg-brand-50 shadow-md">
            {imageUrl ? (
              <Image
                src={imageUrl}
                alt={metadata?.title ?? `Auction #${auction.auction_id}`}
                fill
                className="object-cover"
                unoptimized
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <Gavel size={64} className="text-brand-200" />
              </div>
            )}

            {/* Status badge */}
            <span
              className={`absolute left-4 top-4 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider ${
                isActive
                  ? "bg-green-500 text-white"
                  : isFinalized
                  ? "bg-blue-500 text-white"
                  : "bg-gray-400 text-white"
              }`}
            >
              {auction.status}
            </span>
          </div>

          {/* Info panel */}
          <div className="flex flex-col gap-6">
            {/* Title */}
            <div>
              <h1 className="text-3xl font-display font-bold text-gray-900 leading-tight">
                {metadata?.title ?? `Auction #${auction.auction_id}`}
              </h1>
              {metadata?.description && (
                <p className="mt-2 text-sm text-gray-500 line-clamp-3">
                  {metadata.description}
                </p>
              )}
            </div>

            {/* Countdown */}
            {isActive && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400 flex items-center gap-1">
                  <Clock size={12} />
                  Time Remaining
                </p>
                <Countdown endTime={auction.end_time} />
              </div>
            )}

            {/* Bid summary */}
            <div className="rounded-2xl border border-gray-100 bg-white p-5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm text-gray-500">
                  <Trophy size={14} className="text-brand-500" />
                  Current Bid
                </span>
                <span className="text-xl font-bold text-gray-900">
                  {Number(auction.highest_bid) > 0
                    ? `${highestBidXlm} XLM`
                    : "No bids yet"}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Reserve Price</span>
                <span className="font-medium text-gray-700">
                  {reserveXlm} XLM
                </span>
              </div>
              {auction.highest_bidder && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-500">Highest Bidder</span>
                  <span className="font-mono text-xs text-gray-700 truncate max-w-[180px]">
                    {auction.highest_bidder}
                  </span>
                </div>
              )}
            </div>

            {/* Place bid */}
            {canBid && (
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Place a Bid
                </p>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="0"
                    step="0.0000001"
                    placeholder={`Min. ${reserveXlm} XLM`}
                    value={bidAmountXlm}
                    onChange={(e) => setBidAmountXlm(e.target.value)}
                    className="flex-1 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
                  />
                  <GuardButton
                    onClick={handleBid}
                    disabled={isBidding || !bidAmountXlm}
                    className="rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-600 disabled:opacity-50 transition-all"
                  >
                    {isBidding ? (
                      <RefreshCw size={14} className="animate-spin" />
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <Hammer size={14} /> Bid
                      </span>
                    )}
                  </GuardButton>
                </div>
                {bidError && (
                  <p className="text-xs text-red-500">{bidError}</p>
                )}
                {bidSuccess && (
                  <p className="flex items-center gap-1 text-xs text-green-600">
                    <CheckCircle2 size={13} /> Bid placed successfully!
                  </p>
                )}
              </div>
            )}

            {/* Finalize button (expired active auctions) */}
            {canFinalize && !finalizeSuccess && (
              <div className="space-y-2">
                <GuardButton
                  onClick={handleFinalize}
                  disabled={isFinalizing}
                  className="w-full rounded-xl bg-midnight-900 px-5 py-3 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50 transition-all"
                >
                  {isFinalizing ? (
                    <span className="flex items-center justify-center gap-2">
                      <RefreshCw size={14} className="animate-spin" />{" "}
                      Finalizing…
                    </span>
                  ) : (
                    <span className="flex items-center justify-center gap-2">
                      <Flag size={14} /> Finalize Auction
                    </span>
                  )}
                </GuardButton>
                {finalizeError && (
                  <p className="text-xs text-red-500">{finalizeError}</p>
                )}
              </div>
            )}

            {finalizeSuccess && (
              <div className="flex items-center gap-2 rounded-xl bg-green-50 px-4 py-3 text-sm text-green-700">
                <CheckCircle2 size={16} />
                Auction finalized successfully!
              </div>
            )}

            {(isFinalized || isCancelled) && !finalizeSuccess && (
              <div
                className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm ${
                  isFinalized
                    ? "bg-blue-50 text-blue-700"
                    : "bg-gray-100 text-gray-600"
                }`}
              >
                <CheckCircle2 size={16} />
                {isFinalized
                  ? `Won by ${
                      auction.highest_bidder
                        ? `${auction.highest_bidder.slice(0, 8)}…`
                        : "unknown"
                    } for ${highestBidXlm} XLM`
                  : "Auction ended with no bids"}
              </div>
            )}

            {/* Metadata details */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              {(
                [
                  {
                    icon: Hash,
                    label: "Auction ID",
                    value: `#${auction.auction_id}`,
                  },
                  {
                    icon: User,
                    label: "Creator",
                    value: `${auction.creator.slice(0, 8)}…`,
                  },
                  {
                    icon: Tag,
                    label: "Artist",
                    value: metadata?.artist ?? "—",
                  },
                  {
                    icon: Calendar,
                    label: "End Time",
                    value: new Date(auction.end_time * 1000).toLocaleString(),
                  },
                ] as const
              ).map(({ icon: Icon, label, value }) => (
                <div
                  key={label}
                  className="flex items-start gap-2 rounded-xl border border-gray-100 bg-white p-3"
                >
                  <Icon size={13} className="mt-0.5 shrink-0 text-gray-400" />
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-wide text-gray-400">
                      {label}
                    </p>
                    <p className="truncate font-medium text-gray-700">
                      {value}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Refresh */}
            <button
              onClick={loadData}
              className="flex items-center gap-1.5 self-start text-xs text-gray-400 hover:text-brand-500 transition-colors"
            >
              <RefreshCw size={12} /> Refresh
            </button>
          </div>
        </div>

        {/* Bid History section */}
        <div className="mt-12">
          <div className="flex items-center gap-3 mb-4">
            {(["details", "bids"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-all ${
                  activeTab === t
                    ? "bg-brand-500 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {t === "details" ? "Details" : "Bid History"}
                {t === "bids" && (
                  <span className="ml-1.5 text-xs opacity-70">
                    ({bidHistory.length})
                  </span>
                )}
              </button>
            ))}
          </div>

          {activeTab === "details" && (
            <div className="rounded-2xl border border-gray-100 bg-white p-6 space-y-4">
              {metadata?.description && (
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">
                    Description
                  </h3>
                  <p className="text-sm text-gray-700 leading-relaxed">
                    {metadata.description}
                  </p>
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                {metadata?.category && (
                  <div>
                    <p className="text-xs text-gray-400">Category</p>
                    <p className="font-medium text-gray-700">
                      {metadata.category}
                    </p>
                  </div>
                )}
                {metadata?.year && (
                  <div>
                    <p className="text-xs text-gray-400">Year</p>
                    <p className="font-medium text-gray-700">{metadata.year}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-gray-400">Royalty</p>
                  <p className="font-medium text-gray-700">
                    {(auction.royalty_bps / 100).toFixed(1)}%
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === "bids" && (
            <div className="space-y-2">
              {bidHistory.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-gray-100 bg-white py-16">
                  <History size={32} className="text-gray-300 mb-3" />
                  <p className="text-sm text-gray-500">
                    No bid history available
                  </p>
                </div>
              ) : (
                bidHistory.map((event) => (
                  <BidHistoryRow key={event.id} event={event} />
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
