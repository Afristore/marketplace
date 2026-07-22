// ─────────────────────────────────────────────────────────────
// app/listings/[id]/ListingInteractiveArea.tsx — Client Component
// Handles all interactive UI: tabs, buy, bid, offer actions.
// ─────────────────────────────────────────────────────────────

"use client";

import { useState } from "react";
import {
  stroopsToXlm,
  Listing,
  Auction,
  getListing,
  getAuction,
} from "@/lib/contract";
import { ArtworkMetadata } from "@/lib/ipfs";
import { useWalletContext } from "@/context/WalletContext";
import { useBuyArtwork } from "@/hooks/useMarketplace";
import { usePlaceBid } from "@/hooks/usePlaceBid";
import { useListingOffers, useMakeOffer } from "@/hooks/useOffers";
import { useListingActivity } from "@/hooks/useUserActivity";
import { GuardButton } from "@/components/WalletGuard";
import {
  ExternalLink,
  ShoppingCart,
  User,
  Calendar,
  Hash,
  Clock,
  Gavel,
  History,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  Landmark,
  Share2,
} from "lucide-react";

interface ListingInteractiveAreaProps {
  id: string;
  listing: Listing | null;
  auction: Auction | null;
  metadata: ArtworkMetadata | null;
}

export default function ListingInteractiveArea({
  id,
  listing: initialListing,
  auction: initialAuction,
  metadata,
}: ListingInteractiveAreaProps) {
  const { publicKey } = useWalletContext();

  const [listing, setListing] = useState<Listing | null>(initialListing);
  const [auction, setAuction] = useState<Auction | null>(initialAuction);
  const [activeTab, setActiveTab] = useState<"details" | "history" | "offers">(
    "details"
  );

  // Action hooks
  const { buy, isBuying, error: buyError } = useBuyArtwork(publicKey);
  const { bid, isBidding, error: bidError } = usePlaceBid(publicKey);
  const {
    offers,
    isLoading: isLoadingOffers,
    refresh: refreshOffers,
  } = useListingOffers(id ? Number(id) : null);
  const { activities, isLoading: isLoadingActivity } = useListingActivity(
    id ? Number(id) : null
  );
  const {
    make: makeOffer,
    isOffering,
    error: offerError,
  } = useMakeOffer(publicKey);

  const [bidAmount, setBidAmount] = useState("");
  const [offerAmount, setOfferAmount] = useState("");
  const [offerSuccess, setOfferSuccess] = useState(false);

  const artist = listing?.artist || auction?.creator;
  const isOwn = publicKey === artist;
  const status = listing?.status || auction?.status;
  const isActive = status === "Active";
  
  const calculateRoyaltyPercent = () => {
    const recipients = listing?.recipients || auction?.recipients || [];
    if (recipients.length === 0) return "0.0";
    
    const totalBps = recipients.reduce((sum, r) => sum + (r.percentage || 0), 0);
    return (totalBps / 100).toFixed(1);
  };
  
  const royaltyPercent = calculateRoyaltyPercent();
  const priceDisplay = listing
    ? stroopsToXlm(listing.price)
    : auction
    ? stroopsToXlm(auction.highest_bid || auction.reserve_price)
    : "0";

  const handleBuy = async () => {
    if (!listing) return;
    const success = await buy(listing.listing_id);
    if (success) {
      const updated = await getListing(listing.listing_id);
      setListing(updated);
    }
  };

  const handleBid = async () => {
    if (!auction || !bidAmount) return;
    const success = await bid(auction.auction_id, Number(bidAmount));
    if (success) {
      const updated = await getAuction(auction.auction_id);
      setAuction(updated);
      setBidAmount("");
    }
  };

  const handleMakeOffer = async () => {
    if (!listing || !offerAmount) return;
    const success = await makeOffer(
      listing.listing_id,
      Number(offerAmount),
      listing.token
    );
    if (success) {
      setOfferSuccess(true);
      setOfferAmount("");
      refreshOffers();
      setTimeout(() => setOfferSuccess(false), 3000);
    }
  };

  return (
    <>
      {/* Tabs panel */}
      <div className="rounded-3xl bg-white/5 border border-white/5 p-8 backdrop-blur-sm">
        <div className="flex gap-8 border-b border-white/5 mb-8">
          {(["details", "history", "offers"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-4 text-sm font-bold uppercase tracking-wider transition-all relative ${
                activeTab === tab
                  ? "text-brand-400"
                  : "text-white/40 hover:text-white"
              }`}
            >
              {tab}
              {activeTab === tab && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-400 animate-slide-up" />
              )}
            </button>
          ))}
        </div>

        {activeTab === "details" && (
          <div className="space-y-6 animate-fade-in">
            <p className="text-white/70 leading-relaxed text-lg italic">
              {metadata?.description || "No description provided by the artist."}
            </p>

            <div className="grid grid-cols-2 gap-6 pt-4">
              <div className="space-y-1">
                <span className="text-[10px] uppercase tracking-widest text-white/30 font-bold">
                  Artist
                </span>
                <div className="flex items-center gap-2 group cursor-pointer">
                  <div className="w-8 h-8 rounded-full bg-brand-500/10 flex items-center justify-center text-brand-400 group-hover:bg-brand-500 group-hover:text-white transition-all">
                    <User size={14} />
                  </div>
                  <span className="font-mono text-sm group-hover:text-brand-400 transition-all">
                    {artist?.slice(0, 6)}…{artist?.slice(-4)}
                  </span>
                </div>
              </div>

              {metadata?.year && (
                <div className="space-y-1">
                  <span className="text-[10px] uppercase tracking-widest text-white/30 font-bold">
                    Year Created
                  </span>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-white/60">
                      <Calendar size={14} />
                    </div>
                    <span className="text-sm font-medium">{metadata.year}</span>
                  </div>
                </div>
              )}

              <div className="space-y-1">
                <span className="text-[10px] uppercase tracking-widest text-white/30 font-bold">
                  Metadata
                </span>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-white/5 flex items-center justify-center text-white/60">
                    <Hash size={14} />
                  </div>
                  <a
                    href={`https://ipfs.io/ipfs/${
                      listing?.metadata_cid || auction?.metadata_cid
                    }`}
                    target="_blank"
                    className="text-sm font-mono text-brand-400 hover:underline flex items-center gap-1"
                  >
                    IPFS Link <ExternalLink size={10} />
                  </a>
                </div>
              </div>

              <div className="space-y-1">
                <span className="text-[10px] uppercase tracking-widest text-white/30 font-bold">
                  Royalty
                </span>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-mint-500/10 flex items-center justify-center text-mint-400 font-bold text-[10px]">
                    %
                  </div>
                  <span className="text-sm font-medium">
                    {royaltyPercent}% to Creator
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === "history" && (
          <div className="space-y-6 animate-fade-in max-h-80 overflow-y-auto pr-4 custom-scrollbar">
            {isLoadingActivity ? (
              <div className="py-10 text-center text-white/30">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-200 border-t-brand-500 mx-auto mb-4" />
                <p className="italic">Loading activity…</p>
              </div>
            ) : activities.length > 0 ? (
              activities.map((evt, idx) => (
                <div key={evt.id} className="flex gap-4 relative">
                  {idx !== activities.length - 1 && (
                    <div className="absolute left-[15px] top-8 bottom-[-24px] w-px bg-white/10" />
                  )}
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 z-10 ${
                      evt.type === "LISTED"
                        ? "bg-white/10 text-white"
                        : evt.type === "PURCHASE" || evt.type === "SALE"
                        ? "bg-mint-500/20 text-mint-400"
                        : "bg-brand-500/20 text-brand-400"
                    }`}
                  >
                    {evt.type === "LISTED" && <Hash size={14} />}
                    {(evt.type === "PURCHASE" || evt.type === "SALE") && (
                      <ShoppingCart size={14} />
                    )}
                    {evt.type === "ROYALTY" && <TrendingUp size={14} />}
                  </div>
                  <div className="flex-1 pb-6">
                    <div className="flex justify-between items-start">
                      <p className="text-sm font-bold text-white leading-none mb-1 uppercase tracking-wider">
                        {evt.type}
                      </p>
                      <span className="text-[10px] text-white/30 font-mono">
                        {new Date(evt.timestamp).toLocaleDateString()}
                      </span>
                    </div>
                    <p className="text-xs text-white/50 mb-2 italic">
                      {evt.from.slice(0, 10)}… → {evt.to.slice(0, 10)}…
                    </p>
                    <div className="flex items-center gap-1.5 text-brand-400 font-bold text-sm">
                      <Landmark size={12} /> {evt.price} XLM
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="py-10 text-center text-white/30">
                <History size={40} className="mx-auto mb-4 opacity-20" />
                <p className="italic">No activity recorded yet</p>
              </div>
            )}
          </div>
        )}

        {activeTab === "offers" && (
          <div className="space-y-4 animate-fade-in max-h-80 overflow-y-auto pr-4 custom-scrollbar">
            {isLoadingOffers ? (
              <div className="py-10 text-center text-white/30">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand-200 border-t-brand-500 mx-auto mb-4" />
                <p className="italic">Loading offers…</p>
              </div>
            ) : offers.length > 0 ? (
              offers.map((offer) => (
                <div
                  key={offer.offer_id}
                  className="p-4 rounded-2xl bg-white/5 border border-white/5 flex items-center justify-between group hover:bg-white/10 transition-all"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-brand-500/10 flex items-center justify-center text-brand-400 font-bold">
                      {offer.offerer.slice(0, 1)}
                    </div>
                    <div>
                      <p className="text-xs font-mono text-white/60 mb-1">
                        {offer.offerer.slice(0, 12)}…
                      </p>
                      <div className="flex items-center gap-2 text-brand-400 font-bold">
                        {stroopsToXlm(offer.amount)} XLM
                      </div>
                    </div>
                  </div>
                  {offer.status === "Pending" && (
                    <div className="px-3 py-1 rounded-full bg-mint-500/10 text-mint-400 text-[10px] font-bold uppercase tracking-widest border border-mint-500/20">
                      Active
                    </div>
                  )}
                </div>
              ))
            ) : (
              <div className="py-10 text-center text-white/30">
                <TrendingUp size={40} className="mx-auto mb-4 opacity-20" />
                <p className="italic">No active offers yet</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action panel */}
      <div className="space-y-4">
        {listing && isActive && !isOwn && (
          <GuardButton
            onAction={handleBuy}
            disabled={isBuying}
            actionName="To buy this artwork"
            className="w-full flex items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-brand-500 to-terracotta-500 py-5 text-lg font-black text-white shadow-xl shadow-brand-500/30 hover:shadow-brand-500/50 hover:scale-[1.02] transition-all active:scale-95 disabled:opacity-50"
          >
            <ShoppingCart size={24} />
            {isBuying ? "Processing Payment..." : "Purchase Artwork"}
          </GuardButton>
        )}

        {auction && isActive && !isOwn && (
          <div className="space-y-4">
            <div className="flex gap-4">
              <input
                type="number"
                placeholder="Bid amount..."
                value={bidAmount}
                onChange={(e) => setBidAmount(e.target.value)}
                className="flex-1 rounded-2xl bg-white/5 border border-white/10 px-6 text-white text-lg font-bold focus:outline-none focus:border-brand-500 transition-all"
              />
              <GuardButton
                onAction={handleBid}
                disabled={isBidding || !bidAmount}
                actionName="To place a bid"
                className="rounded-2xl bg-white text-midnight-950 px-8 py-5 text-lg font-black hover:bg-brand-400 hover:text-white transition-all active:scale-95 disabled:opacity-50"
              >
                <Gavel size={24} />
              </GuardButton>
            </div>
            <p className="text-[10px] text-center text-white/30 uppercase tracking-widest">
              Must be at least 5% higher than current bid
            </p>
          </div>
        )}

        {isActive && !isOwn && (
          <div className="space-y-4">
            <div className="flex gap-4">
              <input
                type="number"
                placeholder="Offer amount (XLM)..."
                value={offerAmount}
                onChange={(e) => {
                  setOfferAmount(e.target.value);
                  setOfferSuccess(false);
                }}
                className="flex-1 rounded-2xl bg-white/5 border border-white/10 px-6 text-white text-lg font-bold focus:outline-none focus:border-brand-500 transition-all"
              />
              <GuardButton
                onAction={handleMakeOffer}
                disabled={isOffering || !offerAmount}
                actionName="To make an offer"
                className="rounded-2xl bg-brand-500 text-white px-8 py-5 text-sm uppercase font-black hover:bg-brand-600 transition-all active:scale-95 disabled:opacity-50"
              >
                {isOffering ? "Offering..." : "Make Offer"}
              </GuardButton>
            </div>
            {offerSuccess && (
              <div className="p-3 rounded-xl bg-mint-500/10 border border-mint-500/20 text-mint-400 text-xs flex items-center gap-2">
                <CheckCircle2 size={16} />
                Offer placed successfully!
              </div>
            )}
            {offerError && (
              <div className="p-3 rounded-xl bg-terracotta-500/10 border border-terracotta-500/20 text-terracotta-400 text-xs flex items-center gap-2">
                <AlertCircle size={16} />
                {offerError}
              </div>
            )}
          </div>
        )}

        {isOwn && (
          <div className="p-6 rounded-2xl bg-brand-500/20 border border-brand-500/30 text-center">
            <p className="text-brand-400 font-bold flex items-center justify-center gap-2">
              <CheckCircle2 size={18} />
              You own this listing
            </p>
          </div>
        )}

        {(status === "Sold" || status === "Finalized") && (
          <div className="p-6 rounded-2xl bg-white/5 border border-white/10 text-center">
            <p className="text-white/40 font-bold italic">
              This asset has been privateley collected.
            </p>
          </div>
        )}

        {(buyError || bidError) && (
          <div className="p-4 rounded-xl bg-terracotta-500/10 border border-terracotta-500/20 text-terracotta-400 text-xs flex items-center gap-3">
            <AlertCircle size={16} />
            {buyError || bidError}
          </div>
        )}

        {/* Secondary Actions */}
        <div className="flex gap-3 pt-6">
          <button className="flex-1 h-12 rounded-xl bg-white/5 hover:bg-white/10 transition-all border border-white/5 flex items-center justify-center gap-2 text-xs font-bold text-white/60">
            <Share2 size={14} /> Share
          </button>
          <button className="flex-1 h-12 rounded-xl bg-white/5 hover:bg-white/10 transition-all border border-white/5 flex items-center justify-center gap-2 text-xs font-bold text-white/60">
            <ExternalLink size={14} /> Provenance
          </button>
        </div>

        {/* Auction countdown — needs client clock */}
        {auction && (
          <div className="flex items-center gap-2 text-terracotta-400 font-bold">
            <Clock size={16} />
            <span className="text-xl tabular-nums">
              {auction.end_time > Math.floor(Date.now() / 1000)
                ? new Date(
                    (Number(auction.end_time) -
                      Math.floor(Date.now() / 1000)) *
                      1000
                  )
                    .toISOString()
                    .substr(11, 8)
                : "Ended"}
            </span>
          </div>
        )}
      </div>

      {/* Royalty disclosure */}
      <div className="p-6 rounded-3xl border border-brand-500/10 bg-brand-500/5 backdrop-blur-sm">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-brand-500/20 flex items-center justify-center text-brand-400">
            <TrendingUp size={18} />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white">Creator Earnings</h4>
            <p className="text-xs text-brand-400 font-medium">
              Verified Royalty Support
            </p>
          </div>
        </div>
        <p className="text-xs text-white/50 leading-relaxed mb-4">
          This artwork supports creators with a{" "}
          <span className="text-white font-bold">{royaltyPercent}%</span>{" "}
          royalty on all future secondary sales. Afristore&apos;s smart contract
          automatically enforces these splits to ensure fair compensation.
        </p>
        <div className="flex justify-between text-[10px] font-bold text-white/30 uppercase tracking-widest border-t border-white/5 pt-4">
          <span>Contract ID</span>
          <span className="font-mono">{id}</span>
        </div>
      </div>

      {/* Escrow badge (listing only) */}
      {listing && (
        <div className="flex items-center gap-2 py-2 px-3 bg-mint-500/10 rounded-xl border border-mint-500/20 w-fit">
          <ShieldCheck size={14} className="text-mint-400" />
          <span className="text-[10px] font-bold text-mint-400 uppercase tracking-widest">
            Escrow Verified
          </span>
        </div>
      )}
    </>
  );
}
