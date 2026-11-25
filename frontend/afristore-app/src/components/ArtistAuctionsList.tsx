// ─────────────────────────────────────────────────────────────
// components/ArtistAuctionsList.tsx — creator's auctions on the dashboard
// ─────────────────────────────────────────────────────────────
// Lists the connected artist's auctions with their status, highest bid and
// time remaining, and exposes the creator actions:
//   • Finalize — once an Active auction's end time has passed, settle it so
//     the NFT and funds move and losing bidders are released.
//   • Cancel   — while an Active auction has no bids and has not expired.
// The contract is the final authority; these helpers only hide buttons for
// calls it would certainly reject.
// ─────────────────────────────────────────────────────────────

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  useArtistAuctions,
  useCancelAuction,
  useFinalizeAuction,
} from "@/hooks/useAuctions";
import { Auction, stroopsToXlm } from "@/lib/contract";
import { CheckCircle2, Clock, Gavel, XCircle } from "lucide-react";

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** True once the auction's end time (unix seconds) has passed. */
export function isAuctionExpired(auction: Auction, now = nowSeconds()): boolean {
  return auction.end_time > 0 && auction.end_time <= now;
}

/**
 * An auction can be cancelled only while it is Active, has no bids and has
 * not yet reached its end time.
 */
export function canCancelAuction(auction: Auction, now = nowSeconds()): boolean {
  return (
    auction.status === "Active" &&
    !auction.highest_bidder &&
    !isAuctionExpired(auction, now)
  );
}

/** An Active auction can be finalized once its end time has passed. */
export function canFinalizeAuction(
  auction: Auction,
  now = nowSeconds(),
): boolean {
  return auction.status === "Active" && isAuctionExpired(auction, now);
}

/** Human-readable time remaining, e.g. "2d 4h", "3h 12m", "45s". */
export function formatTimeRemaining(seconds: number): string {
  if (seconds <= 0) return "Ended";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Re-renders every second so countdowns and action buttons stay current. */
function useNow(): number {
  const [now, setNow] = useState(nowSeconds);
  useEffect(() => {
    const id = setInterval(() => setNow(nowSeconds()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const STATUS_BADGE: Record<string, string> = {
  Active: "bg-mint-500/10 text-mint-400 border-mint-500/20",
  Ended: "bg-brand-500/10 text-brand-400 border-brand-500/20",
  Finalized: "bg-white/5 text-white/40 border-white/10",
  Cancelled: "bg-terracotta-500/10 text-terracotta-400 border-terracotta-500/20",
};

interface ArtistAuctionsListProps {
  artistPublicKey: string | null;
}

export function ArtistAuctionsList({ artistPublicKey }: ArtistAuctionsListProps) {
  const now = useNow();
  const { auctions, isLoading, error, refresh } =
    useArtistAuctions(artistPublicKey);
  const {
    cancel,
    isCancelling,
    error: cancelError,
  } = useCancelAuction(artistPublicKey);
  const {
    finalize,
    isFinalizing,
    error: finalizeError,
  } = useFinalizeAuction(artistPublicKey);
  const [pendingId, setPendingId] = useState<number | null>(null);

  const runAction = async (
    auctionId: number,
    action: (id: number) => Promise<boolean>,
  ) => {
    setPendingId(auctionId);
    try {
      const ok = await action(auctionId);
      if (ok) await refresh();
    } finally {
      setPendingId(null);
    }
  };

  if (isLoading && auctions.length === 0) {
    return (
      <div className="space-y-4" data-testid="artist-auctions-loading">
        {[1, 2].map((i) => (
          <div
            key={i}
            className="h-24 animate-pulse rounded-[2rem] bg-white/[0.03] border border-white/5"
          />
        ))}
      </div>
    );
  }

  if (auctions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-[3.5rem] bg-midnight-900/50 border-2 border-dashed border-white/5 py-24 px-10 text-center">
        {error && (
          <p className="mb-6 rounded-2xl bg-red-50 px-6 py-4 text-sm font-bold text-red-600 border border-red-100">
            {error}
          </p>
        )}
        <h3 className="font-display text-3xl font-bold text-white tracking-tight">
          No auctions yet.
        </h3>
        <p className="mt-4 max-w-sm text-sm text-brand-300/40 leading-relaxed font-medium">
          Auctions you create will appear here.
        </p>
      </div>
    );
  }

  const busy = isCancelling || isFinalizing;

  return (
    <div className="grid gap-6">
      {[error, cancelError, finalizeError]
        .filter((e): e is string => Boolean(e))
        .map((e) => (
          <p
            key={e}
            role="alert"
            className="rounded-2xl bg-red-50 px-6 py-4 text-sm font-bold text-red-600 border border-red-100"
          >
            {e}
          </p>
        ))}
      {auctions.map((auction) => {
        const expired = isAuctionExpired(auction, now);
        const displayStatus =
          auction.status === "Active" && expired ? "Ended" : auction.status;
        const hasBid = Boolean(auction.highest_bidder) && auction.highest_bid > BigInt(0);
        const isPending = pendingId === auction.auction_id;

        return (
          <div
            key={auction.auction_id}
            data-testid={`artist-auction-${auction.auction_id}`}
            className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 rounded-[2.5rem] bg-white/[0.03] border border-white/5 p-6 shadow-2xl"
          >
            <div className="flex flex-wrap items-center gap-6 sm:gap-10 w-full lg:w-auto">
              <Link
                href={`/auctions/${auction.auction_id}`}
                className="h-16 w-16 shrink-0 rounded-[1.2rem] bg-brand-500/10 flex items-center justify-center text-brand-400 border border-brand-500/20 shadow-inner hover:bg-brand-500/20 transition-colors"
              >
                <span className="font-bold text-xl">#{auction.auction_id}</span>
              </Link>

              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] uppercase tracking-widest font-bold text-white/40">
                  Reserve
                </span>
                <span className="font-display text-2xl font-bold text-white">
                  {stroopsToXlm(auction.reserve_price)}
                </span>
              </div>

              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] uppercase tracking-widest font-bold text-white/40">
                  Highest Bid
                </span>
                <span
                  className="font-display text-2xl font-bold text-white"
                  data-testid="highest-bid"
                >
                  {hasBid ? stroopsToXlm(auction.highest_bid) : "No bids"}
                </span>
              </div>

              {auction.status === "Active" && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] uppercase tracking-widest font-bold text-white/40">
                    Time Left
                  </span>
                  <span
                    className="flex items-center gap-2 font-mono text-lg font-bold text-white"
                    data-testid="time-left"
                  >
                    <Clock size={16} className="text-brand-400" />
                    {formatTimeRemaining(Math.max(0, auction.end_time - now))}
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-4 w-full lg:w-auto justify-end">
              <span
                className={`px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-[0.2em] border ${
                  STATUS_BADGE[displayStatus] ?? STATUS_BADGE.Finalized
                }`}
              >
                {displayStatus}
              </span>

              {canFinalizeAuction(auction, now) && (
                <button
                  onClick={() => runAction(auction.auction_id, finalize)}
                  disabled={busy}
                  className="flex justify-center items-center gap-2 rounded-xl bg-brand-500 hover:bg-brand-600 px-4 py-2 text-sm font-bold text-white transition-all shadow-sm disabled:opacity-50"
                >
                  {isPending && isFinalizing ? (
                    <Gavel size={16} className="animate-pulse" />
                  ) : (
                    <CheckCircle2 size={16} />
                  )}
                  {isPending && isFinalizing ? "Finalizing…" : "Finalize Auction"}
                </button>
              )}

              {canCancelAuction(auction, now) && (
                <button
                  onClick={() => runAction(auction.auction_id, cancel)}
                  disabled={busy}
                  className="flex justify-center items-center gap-2 rounded-xl bg-white/5 hover:bg-terracotta-500/20 px-4 py-2 text-sm font-bold text-terracotta-400 border border-white/10 hover:border-terracotta-500/30 transition-all shadow-sm disabled:opacity-50"
                >
                  <XCircle size={16} />
                  {isPending && isCancelling ? "Cancelling…" : "Cancel Auction"}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
