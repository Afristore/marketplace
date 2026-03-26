// -----------------------------------------------------------------
// app/offers/incoming/page.tsx -- Owner Offer Inbox
// -----------------------------------------------------------------

"use client";

import { useWalletContext } from "@/context/WalletContext";
import { useIncomingOffers, useAcceptOffer, useRejectOffer } from "@/hooks/useOffers";
import { stroopsToXlm, Offer, Listing } from "@/lib/contract";
import { Inbox, Clock, CheckCircle, XCircle, MoreVertical, ArrowUpRight, History, Activity, TrendingUp, Loader2, User } from "lucide-react";
import { WalletGuard } from "@/components/WalletGuard";
import { SUPPORTED_TOKENS } from "@/config/tokens";
import { clsx } from "clsx";
import Link from "next/link";

export default function IncomingOffersPage() {
  const { publicKey } = useWalletContext();
  const { offersByListing, isLoading, error, refresh } = useIncomingOffers(publicKey);
  const { accept, isAccepting, error: acceptError } = useAcceptOffer(publicKey);
  const { reject, isRejecting, error: rejectError } = useRejectOffer(publicKey);

  // Flatten all offers for stats
  const allOffers = offersByListing.flatMap(
    (group: { listing: Listing; offers: Offer[] }) => group.offers
  );
  const pendingCnt = allOffers.filter((o: Offer) => o.status === "Pending").length;
  const acceptedCnt = allOffers.filter((o: Offer) => o.status === "Accepted").length;

  const getTokenSymbol = (address: string) => {
    return SUPPORTED_TOKENS.find(t => t.address === address)?.symbol || "Tokens";
  };

  return (
    <div className="min-h-screen bg-midnight-950 pb-20 pt-24 selection:bg-brand-500 selection:text-white">
      {/* Heritage Background Pattern */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.03] z-0 overflow-hidden">
        <div className="absolute inset-0 tribal-pattern scale-150 rotate-12" />
      </div>

      <WalletGuard actionName="To access your offer inbox">
        <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">

          {/* Header — Heritage Glow Design */}
          <div className="relative mb-12 overflow-hidden rounded-[3rem] bg-midnight-900 border border-white/5 shadow-2xl p-8 sm:p-12">
            <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-brand-500/10 blur-[100px]" />
            <div className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-mint-500/10 blur-[100px]" />
            <div className="absolute top-0 right-0 left-0 tribal-strip h-1.5 opacity-40" />

            <div className="relative flex flex-col items-center justify-between gap-10 md:flex-row md:items-start">
              <div className="flex flex-col items-center gap-8 md:flex-row md:items-start text-center md:text-left">
                <div className="relative group">
                  <div className="absolute -inset-1.5 rounded-[2.5rem] bg-gradient-to-tr from-brand-500 via-terracotta-400 to-mint-500 opacity-80 blur transition duration-700 group-hover:opacity-100 group-hover:duration-200" />
                  <div className="relative flex h-28 w-28 items-center justify-center rounded-[2.2rem] bg-midnight-950 border border-white/10 shadow-2xl overflow-hidden group-hover:scale-[1.02] transition-transform duration-500">
                    <Inbox size={56} className="text-brand-400/80 group-hover:text-brand-400 transition-colors" />
                  </div>
                </div>

                <div className="flex flex-col gap-4">
                  <div className="space-y-1">
                    <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-white">
                      Offer <span className="text-brand-400">Inbox</span>
                    </h1>
                    <p className="text-brand-300/60 font-medium text-sm tracking-widest uppercase">Manage incoming requests</p>
                  </div>

                  <div className="flex flex-col gap-3 font-mono">
                    <p className="text-[11px] sm:text-xs text-mint-400/90 break-all bg-white/5 px-4 py-2.5 rounded-2xl border border-white/10 backdrop-blur-md shadow-inner inline-flex">
                      {publicKey}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Stats Metrics Area */}
          <div className="mb-12 grid gap-6 sm:grid-cols-3">
            {[
              { label: "Total Received", value: allOffers.length, icon: History, color: "brand" },
              { label: "Needs Review", value: pendingCnt, icon: Activity, color: "mint" },
              { label: "Total Accepted", value: acceptedCnt, icon: TrendingUp, color: "terracotta" },
            ].map(({ label, value, icon: Icon, color }) => (
              <div
                key={label}
                className={clsx(
                  "group relative rounded-[2.5rem] bg-white/5 border border-white/10 p-6 backdrop-blur-md transition-all duration-500 hover:border-white/20 overflow-hidden shadow-2xl",
                  color === "brand" && "hover:border-brand-500/30 hover:bg-white/[0.07]",
                  color === "mint" && "hover:border-mint-500/30 hover:bg-white/[0.07]",
                  color === "terracotta" && "hover:border-terracotta-500/30 hover:bg-white/[0.07]"
                )}
              >
                <div className={clsx(
                  "absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl transition-colors",
                  color === "brand" && "bg-brand-500/5 group-hover:bg-brand-500/10",
                  color === "mint" && "bg-mint-500/5 group-hover:bg-mint-500/10",
                  color === "terracotta" && "bg-terracotta-500/5 group-hover:bg-terracotta-500/10"
                )} />
                <div className="flex items-center justify-between relative z-10">
                  <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-white/40">{label}</p>
                  <div className={clsx(
                    "rounded-full p-2 border",
                    color === "brand" ? "border-brand-500/20 bg-brand-500/10" :
                      color === "mint" ? "border-mint-500/20 bg-mint-500/10" :
                        "border-terracotta-500/20 bg-terracotta-500/10"
                  )}>
                    <Icon size={16} className={clsx(
                      color === "brand" ? "text-brand-400" :
                        color === "mint" ? "text-mint-400" :
                          "text-terracotta-400"
                    )} />
                  </div>
                </div>
                <p className="mt-4 text-4xl font-display font-bold tracking-tight text-white relative z-10">{value}</p>
              </div>
            ))}
          </div>

          {/* Error banners */}
          {(error || acceptError || rejectError) && (
            <div className="mb-8 rounded-3xl border border-terracotta-500/20 bg-terracotta-500/5 px-6 py-4 text-sm font-bold text-terracotta-400 backdrop-blur-md flex items-center gap-3 animate-fade-in shadow-xl">
              <XCircle size={20} />
              {error || acceptError || rejectError}
            </div>
          )}

          {/* Content area */}
          <div className="animate-fade-in duration-700">
            {isLoading ? (
              <div className="space-y-12">
                {[1, 2].map((i) => (
                  <div key={i} className="animate-pulse">
                    <div className="h-10 w-64 rounded-xl bg-white/[0.03] mb-6" />
                    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                      {[1, 2, 3].map(j => <div key={j} className="h-64 rounded-[2.5rem] bg-white/[0.03] border border-white/5" />)}
                    </div>
                  </div>
                ))}
              </div>
            ) : allOffers.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-[3.5rem] bg-midnight-900/50 border-2 border-dashed border-white/5 py-32 px-10 text-center backdrop-blur-sm relative overflow-hidden group">
                <div className="absolute inset-0 tribal-pattern opacity-[0.02] group-hover:opacity-[0.04] transition-opacity duration-500" />
                <div className="relative mb-10 flex h-28 w-28 items-center justify-center rounded-[2.5rem] bg-midnight-950 text-white/10 shadow-inner group-hover:text-brand-500/30 transition-colors duration-500">
                  <Inbox size={48} />
                </div>
                <h3 className="font-display text-3xl font-bold text-white tracking-tight relative z-10">No incoming offers yet.</h3>
                <p className="mt-4 max-w-sm text-sm text-brand-300/40 leading-relaxed font-medium relative z-10">
                  When buyers make offers on your artworks, they will appear here grouped by listing.
                </p>
              </div>
            ) : (
              <div className="space-y-16">
                {offersByListing.map((group) => (
                  <div key={group.listing.listing_id} className="relative group/listing">
                    {/* Listing Group Header */}
                    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8 pb-4 border-b border-white/5">
                      <div className="flex items-center gap-6">
                        <div className="flex flex-col">
                          <h2 className="font-display text-2xl font-bold text-white tracking-tight">
                            Listing <span className="text-mint-400">#{group.listing.listing_id}</span>
                          </h2>
                          <p className="text-[10px] font-mono text-white/20 break-all">{group.listing.metadata_cid}</p>
                        </div>
                        <div className={clsx(
                          "px-4 py-1 rounded-full text-[9px] font-bold uppercase tracking-[0.2em] border",
                          group.listing.status === "Active" ? "border-brand-500/30 text-brand-400 bg-brand-500/5" : "border-white/10 text-white/30 bg-white/5"
                        )}>
                          {group.listing.status}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-white/30 text-xs font-bold uppercase tracking-widest">
                        <Activity size={14} className="text-mint-500/40" />
                        {group.offers.length} offer{group.offers.length !== 1 ? "s" : ""} received
                      </div>
                    </div>

                    {/* Offers Grid for this Listing */}
                    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                      {group.offers.map((o) => (
                        <div key={o.offer_id} className="group relative flex flex-col rounded-[2.5rem] bg-white/[0.03] hover:bg-white/[0.07] hover:border-white/10 transition-all duration-500 border border-white/5 p-6 shadow-2xl overflow-hidden min-h-[320px]">
                          {/* BG Tribal Accent */}
                          <div className="absolute -top-10 -right-10 tribal-pattern opacity-[0.02] scale-50 group-hover:scale-75 transition-transform duration-1000" />

                          <div className="flex items-center justify-between mb-8">
                            <div className="flex items-center gap-3">
                              <div className="h-10 w-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                                <User size={18} className="text-white/20" />
                              </div>
                              <div className="flex flex-col">
                                <span className="text-[9px] uppercase font-bold text-white/20 tracking-widest">Offerer</span>
                                <span className="text-xs font-mono text-white/60">{o.offerer.slice(0, 6)}...{o.offerer.slice(-4)}</span>
                              </div>
                            </div>
                            <div className={clsx(
                              "px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-widest border",
                              o.status === "Pending" ? "bg-brand-500/10 text-brand-400 border-brand-500/20" :
                                o.status === "Accepted" ? "bg-mint-500/10 text-mint-400 border-mint-500/20" :
                                  "bg-white/5 text-white/30 border-white/10"
                            )}>
                              {o.status}
                            </div>
                          </div>

                          <div className="flex flex-col gap-1 mb-10">
                            <p className="text-[10px] font-bold text-white/40 uppercase tracking-[0.2em]">Offered Price</p>
                            <div className="flex items-baseline gap-2">
                              <span className="font-display text-4xl font-bold text-white">{stroopsToXlm(o.amount)}</span>
                              <span className="text-[11px] font-bold text-brand-400 uppercase tracking-widest">{getTokenSymbol(o.token)}</span>
                            </div>
                          </div>

                          <div className="mt-auto space-y-4">
                            <div className="flex items-center justify-between py-4 border-t border-white/5 text-[10px] uppercase font-bold tracking-widest text-white/20">
                              <span>Date Placed</span>
                              <span className="text-white/40">{new Date(o.created_at * 1000).toLocaleDateString()}</span>
                            </div>

                            {o.status === "Pending" && (
                              <div className="grid grid-cols-2 gap-3">
                                <button
                                  onClick={async () => {
                                    const ok = await accept(o.offer_id);
                                    if (ok) refresh();
                                  }}
                                  disabled={isAccepting || isRejecting}
                                  className="flex items-center justify-center gap-2 rounded-2xl bg-mint-500/20 hover:bg-mint-500/30 py-3.5 text-xs font-bold text-mint-400 border border-mint-500/30 transition-all hover:scale-[1.02] disabled:opacity-50 group/btn"
                                >
                                  {isAccepting ? <Loader2 size={16} className="animate-spin" /> : (
                                    <>
                                      <CheckCircle size={16} className="group-hover/btn:scale-110 transition-transform" />
                                      Accept
                                    </>
                                  )}
                                </button>
                                <button
                                  onClick={async () => {
                                    const ok = await reject(o.offer_id);
                                    if (ok) refresh();
                                  }}
                                  disabled={isAccepting || isRejecting}
                                  className="flex items-center justify-center gap-2 rounded-2xl bg-white/5 hover:bg-terracotta-500/20 py-3.5 text-xs font-bold text-white/60 hover:text-terracotta-400 border border-white/10 hover:border-terracotta-500/30 transition-all disabled:opacity-50 group/rej"
                                >
                                  {isRejecting ? <Loader2 size={16} className="animate-spin" /> : (
                                    <>
                                      <XCircle size={16} className="group-hover/rej:scale-110 transition-transform" />
                                      Reject
                                    </>
                                  )}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </WalletGuard>
    </div>
  );
}
