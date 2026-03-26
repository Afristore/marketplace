// ─────────────────────────────────────────────────────────────
// app/offers/page.tsx — Offerer Dashboard
// ─────────────────────────────────────────────────────────────

"use client";

import { useState } from "react";
import Link from "next/link";
import { useWalletContext } from "@/context/WalletContext";
import { useOffererOffers, useWithdrawOffer } from "@/hooks/useOffers";
import { stroopsToXlm, Offer } from "@/lib/contract";
import { ShoppingBag, Clock, CheckCircle, XCircle, ArrowUpRight, History, Activity, TrendingUp, Loader2 } from "lucide-react";
import { WalletGuard } from "@/components/WalletGuard";
import { SUPPORTED_TOKENS } from "@/config/tokens";
import { clsx } from "clsx";

type Tab = "all" | "Pending" | "Accepted" | "Rejected" | "Withdrawn";

export default function OffersPage() {
  const { publicKey } = useWalletContext();
  const { offers, isLoading, error, refresh } = useOffererOffers(publicKey);
  const { withdraw, isWithdrawing, error: withdrawError } = useWithdrawOffer(publicKey);
  const [tab, setTab] = useState<Tab>("all");

  const pendingCnt = offers.filter((o: Offer) => o.status === "Pending").length;
  const acceptedCnt = offers.filter((o: Offer) => o.status === "Accepted").length;

  const filtered =
    tab === "all" ? offers : offers.filter((o: Offer) => o.status === tab);

  const getTokenSymbol = (address: string) => {
    return SUPPORTED_TOKENS.find(t => t.address === address)?.symbol || "Tokens";
  };

  const tabs: { key: Tab; label: string; icon: any }[] = [
    { key: "all", label: "All Offers", icon: History },
    { key: "Pending", label: "Pending", icon: Clock },
    { key: "Accepted", label: "Accepted", icon: CheckCircle },
    { key: "Rejected", label: "Rejected", icon: XCircle },
    { key: "Withdrawn", label: "Withdrawn", icon: History },
  ];

  return (
    <div className="min-h-screen bg-midnight-950 pb-20 pt-24 selection:bg-brand-500 selection:text-white">
      {/* Heritage Background Pattern */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.03] z-0 overflow-hidden">
        <div className="absolute inset-0 tribal-pattern scale-150 rotate-12" />
      </div>

      <WalletGuard actionName="To access your offers dashboard">
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
                    <ShoppingBag size={56} className="text-brand-400/80 group-hover:text-brand-400 transition-colors" />
                  </div>
                </div>

                <div className="flex flex-col gap-4">
                  <div className="space-y-1">
                    <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-white">
                      My <span className="text-brand-400">Offers</span>
                    </h1>
                    <p className="text-brand-300/60 font-medium text-sm tracking-widest uppercase">Track your art acquisitions</p>
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
              { label: "Total Placed", value: offers.length, icon: History, color: "brand" },
              { label: "Pending Response", value: pendingCnt, icon: Activity, color: "mint" },
              { label: "Successfully Accepted", value: acceptedCnt, icon: TrendingUp, color: "terracotta" },
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

          {/* Navigational Tabs */}
          <div className="mb-10 flex flex-wrap gap-2 border-b border-white/5 pb-px overflow-x-auto no-scrollbar scroll-smooth">
            {tabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={clsx(
                  "group relative flex items-center gap-3 px-6 sm:px-8 py-5 text-sm font-bold transition-all duration-500 whitespace-nowrap",
                  tab === key ? "text-brand-400" : "text-white/40 hover:text-white"
                )}
              >
                <Icon size={18} className={clsx(
                  "transition-all duration-500 group-hover:scale-125",
                  tab === key && "text-brand-400 drop-shadow-[0_0_8px_rgba(226,125,96,0.5)]"
                )} />
                {label}
                {tab === key && (
                  <div className="absolute inset-x-4 bottom-0 h-1.5 rounded-t-full bg-brand-500 shadow-[0_-5px_15px_rgba(226,125,96,0.6)] animate-slide-in-right" />
                )}
              </button>
            ))}
          </div>

          {/* Error banners */}
          {(error || withdrawError) && (
            <div className="mb-8 rounded-3xl border border-terracotta-500/20 bg-terracotta-500/5 px-6 py-4 text-sm font-bold text-terracotta-400 backdrop-blur-md flex items-center gap-3 animate-fade-in">
              <XCircle size={20} />
              {error || withdrawError}
            </div>
          )}

          {/* Content area */}
          <div className="animate-fade-in duration-700">
            {isLoading ? (
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-64 animate-pulse rounded-[2.5rem] bg-white/[0.03] border border-white/5" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-[3.5rem] bg-midnight-900/50 border-2 border-dashed border-white/5 py-32 px-10 text-center backdrop-blur-sm relative overflow-hidden group">
                <div className="absolute inset-0 tribal-pattern opacity-[0.02] group-hover:opacity-[0.04] transition-opacity duration-500" />
                <div className="relative mb-10 flex h-28 w-28 items-center justify-center rounded-[2.5rem] bg-midnight-950 text-white/10 shadow-inner group-hover:text-brand-500/30 transition-colors duration-500">
                  <ShoppingBag size={48} />
                </div>
                <h3 className="font-display text-3xl font-bold text-white tracking-tight relative z-10">
                  {tab === "all" ? "No offers yet." : `No ${tab.toLowerCase()} offers.`}
                </h3>
                <p className="mt-4 max-w-sm text-sm text-brand-300/40 leading-relaxed font-medium relative z-10">
                  Your offers help secure the most beautiful African art pieces.
                </p>
                {tab === "all" && (
                  <Link
                    href="/"
                    className="mt-8 rounded-2xl bg-brand-500 px-8 py-3.5 text-lg font-bold text-white hover:bg-brand-600 shadow-xl shadow-brand-500/20 transition-all hover:scale-[1.02] relative z-10"
                  >
                    Browse listings
                  </Link>
                )}
              </div>
            ) : (
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map((o) => (
                  <div key={o.offer_id} className="group relative flex flex-col rounded-[2.5rem] bg-white/[0.03] hover:bg-white/[0.07] hover:border-white/10 transition-all duration-500 border border-white/5 p-6 shadow-2xl overflow-hidden">
                    {/* Background Pattern Hint */}
                    <div className="absolute -top-10 -right-10 tribal-pattern opacity-[0.03] scale-50 group-hover:rotate-12 transition-transform duration-700" />

                    <div className="flex items-center justify-between mb-6">
                      <div className="h-12 w-12 rounded-[1rem] bg-white/5 flex items-center justify-center text-white/40 border border-white/10 shadow-inner">
                        <span className="font-bold text-sm font-mono">#{o.offer_id}</span>
                      </div>
                      <span className={clsx(
                        "px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-[0.2em] border",
                        o.status === "Pending" ? "bg-brand-500/10 text-brand-400 border-brand-500/20" :
                          o.status === "Accepted" ? "bg-mint-500/10 text-mint-400 border-mint-500/20" :
                            o.status === "Rejected" ? "bg-terracotta-500/10 text-terracotta-400 border-terracotta-500/20" :
                              "bg-white/5 text-white/40 border-white/10"
                      )}>
                        {o.status}
                      </span>
                    </div>

                    <div className="flex flex-col gap-1 mb-8">
                      <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Offer Amount</p>
                      <div className="flex items-baseline gap-2">
                        <span className="font-display text-4xl font-bold text-white">{stroopsToXlm(o.amount)}</span>
                        <span className="text-[11px] font-bold text-brand-400 uppercase tracking-widest">{getTokenSymbol(o.token)}</span>
                      </div>
                    </div>

                    <div className="mt-auto space-y-6">
                      <div className="flex items-center justify-between pt-6 border-t border-white/5">
                        <div className="flex flex-col">
                          <span className="text-[10px] uppercase font-bold text-white/20 tracking-widest mb-1">Target Listing</span>
                          <Link
                            href={`/listings/${o.listing_id}`}
                            className="text-xs font-mono text-mint-400 hover:text-mint-300 flex items-center gap-1 transition-colors"
                          >
                            #{o.listing_id}
                            <ArrowUpRight size={12} />
                          </Link>
                        </div>
                        <div className="flex flex-col text-right">
                          <span className="text-[10px] uppercase font-bold text-white/20 tracking-widest mb-1">Placed On</span>
                          <span className="text-xs text-white/40">{new Date(o.created_at * 1000).toLocaleDateString()}</span>
                        </div>
                      </div>

                      {o.status === "Pending" && (
                        <button
                          onClick={async () => {
                            const ok = await withdraw(o.offer_id);
                            if (ok) refresh();
                          }}
                          disabled={isWithdrawing}
                          className="w-full flex items-center justify-center gap-2 rounded-2xl bg-white/5 hover:bg-terracotta-500/20 py-4 text-xs font-bold text-terracotta-400 border border-white/10 hover:border-terracotta-500/30 transition-all shadow-xl group/btn"
                        >
                          {isWithdrawing ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <>
                              <XCircle size={16} className="group-hover/btn:scale-110 transition-transform" />
                              Withdraw Offer
                            </>
                          )}
                        </button>
                      )}
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
