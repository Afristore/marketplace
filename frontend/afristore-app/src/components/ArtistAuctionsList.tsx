// ─────────────────────────────────────────────────────────────
// components/ArtistAuctionsList.tsx — creator's auctions on the dashboard
// ─────────────────────────────────────────────────────────────
// Lists the connected artist's auctions and lets them cancel any auction
// that can still be cancelled. The contract is the final authority; this
// only hides the button for auctions it would certainly reject.
// ─────────────────────────────────────────────────────────────

"use client";

import { useArtistAuctions, useCancelAuction } from "@/hooks/useAuctions";
import { Auction, stroopsToXlm } from "@/lib/contract";
import { XCircle } from "lucide-react";

/**
 * An auction can be cancelled only while it is Active and has no bids.
 * Expiry is checked on-chain, so an auction past its end time may still show
 * the button; the contract's rejection is shown to the creator in that case.
 */
export function canCancelAuction(auction: Auction): boolean {
  return auction.status === "Active" && !auction.highest_bidder;
}

const STATUS_BADGE: Record<string, string> = {
  Active: "bg-mint-500/10 text-mint-400 border-mint-500/20",
  Finalized: "bg-white/5 text-white/40 border-white/10",
  Cancelled: "bg-terracotta-500/10 text-terracotta-400 border-terracotta-500/20",
};

interface ArtistAuctionsListProps {
  artistPublicKey: string | null;
}

export function ArtistAuctionsList({ artistPublicKey }: ArtistAuctionsListProps) {
  const { auctions, isLoading, error, refresh } =
    useArtistAuctions(artistPublicKey);
  const {
    cancel,
    isCancelling,
    error: cancelError,
  } = useCancelAuction(artistPublicKey);

  if (isLoading) {
    return (
      <div className="space-y-4">
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
        <h3 className="font-display text-3xl font-bold text-white tracking-tight">
          No auctions yet.
        </h3>
        <p className="mt-4 max-w-sm text-sm text-brand-300/40 leading-relaxed font-medium">
          Auctions you create will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      {error && (
        <p className="rounded-2xl bg-red-50 px-6 py-4 text-sm font-bold text-red-600 border border-red-100">
          {error}
        </p>
      )}
      {cancelError && (
        <p className="rounded-2xl bg-red-50 px-6 py-4 text-sm font-bold text-red-600 border border-red-100">
          {cancelError}
        </p>
      )}
      {auctions.map((auction) => (
        <div
          key={auction.auction_id}
          className="flex flex-col sm:flex-row items-center justify-between gap-6 rounded-[2.5rem] bg-white/[0.03] border border-white/5 p-6 shadow-2xl"
        >
          <div className="flex items-center gap-6 w-full sm:w-auto">
            <div className="h-16 w-16 rounded-[1.2rem] bg-brand-500/10 flex items-center justify-center text-brand-400 border border-brand-500/20 shadow-inner">
              <span className="font-bold text-xl">#{auction.auction_id}</span>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] uppercase tracking-widest font-bold text-white/40">
                Reserve
              </span>
              <span className="font-display text-2xl font-bold text-white">
                {stroopsToXlm(auction.reserve_price)}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4 w-full sm:w-auto justify-end">
            <span
              className={`px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-[0.2em] border ${
                STATUS_BADGE[auction.status] ?? STATUS_BADGE.Finalized
              }`}
            >
              {auction.status}
            </span>
            {canCancelAuction(auction) && (
              <button
                onClick={async () => {
                  const ok = await cancel(auction.auction_id);
                  if (ok) refresh();
                }}
                disabled={isCancelling}
                className="flex justify-center items-center gap-2 rounded-xl bg-white/5 hover:bg-terracotta-500/20 px-4 py-2 text-sm font-bold text-terracotta-400 border border-white/10 hover:border-terracotta-500/30 transition-all shadow-sm disabled:opacity-50"
              >
                <XCircle size={16} />
                Cancel Auction
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
