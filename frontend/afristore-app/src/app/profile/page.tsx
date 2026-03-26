"use client";

import { useEffect, useState, useMemo } from "react";
import { useWalletContext } from "@/context/WalletContext";
import { WalletGuard } from "@/components/WalletGuard";
import { EnrichedListing, useArtistListings, useMarketplace } from "@/hooks/useMarketplace";
import { useUserActivity } from "@/hooks/useUserActivity";
import { ListingCard } from "@/components/ListingCard";
import {
    History,
    Package,
    Tag,
    ShoppingBag,
    TrendingUp,
    Clock,
    ExternalLink,
    ChevronRight,
    User as UserIcon,
    Award,
    CircleDollarSign,
    Activity
} from "lucide-react";
import { Listing, stroopsToXlm } from "@/lib/contract";
import { ActivityEvent } from "@/lib/indexer";
import { clsx } from "clsx";

type ProfileTab = "purchased" | "listings" | "sold" | "activity";

export default function ProfilePage() {
    const { publicKey } = useWalletContext();
    const [activeTab, setActiveTab] = useState<ProfileTab>("purchased");

    // Hook for Indexer activity
    const {
        activities,
        royaltyStats,
        isLoading: loadingActivity
    } = useUserActivity(publicKey);

    // Contract state
    const { listings: allListings, isLoading: loadingAll } = useMarketplace();
    const { listings: myArtistListings, isLoading: loadingArtist } = useArtistListings(publicKey);

    const isGlobalLoading = loadingAll || loadingArtist || loadingActivity;

    // Derive "Purchased"
    const purchasedArtworks = useMemo(() => {
        if (!publicKey) return [];
        return allListings.filter(l => l.owner === publicKey && l.artist !== publicKey);
    }, [allListings, publicKey]);

    const soldArtworks = useMemo(() => {
        return myArtistListings.filter(l => l.status === "Sold");
    }, [myArtistListings]);

    const activeListings = useMemo(() => {
        return myArtistListings.filter(l => l.status === "Active");
    }, [myArtistListings]);

    return (
        <div className="min-h-screen bg-midnight-950 pb-20 pt-24 selection:bg-brand-500 selection:text-white">
            {/* Heritage Background Pattern */}
            <div className="fixed inset-0 pointer-events-none opacity-[0.03] z-0 overflow-hidden">
                <div className="absolute inset-0 tribal-pattern scale-150 rotate-12" />
            </div>

            <WalletGuard actionName="To access your personal art gallery">
                <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">

                    {/* Profile Header — Heritage Glow Design */}
                    <div className="relative mb-12 overflow-hidden rounded-[3rem] bg-midnight-900 border border-white/5 shadow-2xl p-8 sm:p-12">
                        {/* Background Accents */}
                        <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-brand-500/10 blur-[100px]" />
                        <div className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-mint-500/10 blur-[100px]" />
                        <div className="absolute top-0 right-0 left-0 tribal-strip h-1.5 opacity-40" />

                        <div className="relative flex flex-col items-center justify-between gap-10 md:flex-row md:items-start">
                            {/* User Identity Section */}
                            <div className="flex flex-col items-center gap-8 md:flex-row md:items-start text-center md:text-left">
                                <div className="relative group">
                                    <div className="absolute -inset-1.5 rounded-[2.5rem] bg-gradient-to-tr from-brand-500 via-terracotta-400 to-mint-500 opacity-80 blur transition duration-700 group-hover:opacity-100 group-hover:duration-200"></div>
                                    <div className="relative flex h-28 w-28 items-center justify-center rounded-[2.2rem] bg-midnight-950 border border-white/10 shadow-2xl overflow-hidden group-hover:scale-[1.02] transition-transform duration-500">
                                        <UserIcon size={56} className="text-brand-400/80 group-hover:text-brand-400 transition-colors" />
                                        <div className="absolute bottom-0 right-0 h-8 w-8 bg-mint-500 text-midnight-950 flex items-center justify-center rounded-tl-2xl shadow-lg border-t border-l border-white/20">
                                            <Award size={16} />
                                        </div>
                                    </div>
                                </div>

                                <div className="flex flex-col gap-4">
                                    <div className="space-y-1">
                                        <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-white">
                                            African <span className="text-brand-400">Patron</span>
                                        </h1>
                                        <p className="text-brand-300/60 font-medium text-sm tracking-widest uppercase">Member Since 2025 • Collector Tier I</p>
                                    </div>

                                    <div className="flex flex-col gap-3 font-mono">
                                        <p className="text-[11px] sm:text-xs text-mint-400/90 break-all bg-white/5 px-4 py-2.5 rounded-2xl border border-white/10 backdrop-blur-md shadow-inner">
                                            {publicKey}
                                        </p>
                                        <div className="flex flex-wrap justify-center md:justify-start gap-4">
                                            <div className="flex items-center gap-2 text-[10px] font-bold text-mint-400 uppercase tracking-[0.2em] bg-mint-500/10 px-3 py-1.5 rounded-full border border-mint-500/20">
                                                <div className="h-1.5 w-1.5 rounded-full bg-mint-500 animate-pulse" />
                                                Live on Testnet
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Stats / Earnings Summary Card */}
                            <div className="w-full md:w-auto self-center lg:self-start lg:mt-2">
                                <div className="group relative rounded-[2.5rem] bg-white/5 border border-white/10 p-1 backdrop-blur-md transition-all duration-500 hover:border-brand-500/30 hover:bg-white/[0.07]">
                                    <div className="flex flex-col px-8 py-6 text-center">
                                        <div className="mb-3 flex justify-center">
                                            <div className="h-10 w-10 rounded-full bg-brand-500/10 flex items-center justify-center text-brand-400 shadow-lg shadow-brand-500/5 group-hover:shadow-brand-500/20 transition-all">
                                                <CircleDollarSign size={20} />
                                            </div>
                                        </div>
                                        <p className="text-[10px] uppercase tracking-[0.3em] text-white/40 font-bold mb-1">Creator Royalties</p>
                                        <p className="font-display text-4xl font-bold text-white tracking-tight">
                                            {royaltyStats?.totalEarned || "0.00"}<span className="ml-1.5 text-xs font-sans text-brand-400/80 tracking-normal">XLM</span>
                                        </p>
                                        <div className="mt-3 flex items-center justify-center gap-2 text-[10px] font-bold text-mint-400 uppercase tracking-widest bg-mint-500/5 rounded-full py-1.5 px-4 border border-mint-500/10 transition-all group-hover:border-mint-500/20 group-hover:bg-mint-500/10">
                                            <Award size={10} /> {royaltyStats?.payoutCount || 0} Payouts Found
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Navigational Tabs — Premium Heritage Bar */}
                    <div className="mb-10 flex flex-wrap gap-2 border-b border-white/5 pb-px overflow-x-auto no-scrollbar scroll-smooth">
                        {[
                            { id: "purchased", label: "My Collections", icon: ShoppingBag, count: purchasedArtworks.length },
                            { id: "listings", label: "Active Listings", icon: Tag, count: activeListings.length },
                            { id: "sold", label: "Heritage Sold", icon: TrendingUp, count: soldArtworks.length },
                            { id: "activity", label: "On-Chain Activity", icon: Activity, count: activities.length },
                        ].map((tab) => {
                            const Icon = tab.icon;
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id as ProfileTab)}
                                    className={clsx(
                                        "group relative flex items-center gap-3 px-8 py-6 text-sm font-bold transition-all duration-500 whitespace-nowrap",
                                        isActive ? "text-brand-400" : "text-white/40 hover:text-white"
                                    )}
                                >
                                    <Icon size={18} className={clsx("transition-all duration-500 group-hover:scale-125", isActive && "text-brand-400 drop-shadow-[0_0_8px_rgba(226,125,96,0.5)]")} />
                                    {tab.label}
                                    {tab.count !== undefined && (
                                        <span className={clsx(
                                            "ml-2 rounded-lg px-2 py-0.5 text-[10px] font-bold shadow-2xl transition-all duration-500",
                                            isActive ? "bg-brand-500 text-white shadow-brand-500/20" : "bg-white/5 text-white/20 border border-white/5"
                                        )}>
                                            {tab.count}
                                        </span>
                                    )}
                                    {isActive && (
                                        <div className="absolute inset-x-4 bottom-0 h-1.5 rounded-t-full bg-brand-500 shadow-[0_-5px_15px_rgba(226,125,96,0.6)] animate-slide-in-right" />
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    {/* Tab Content Panels — Heritage Fade Transition */}
                    <div className="mt-10">
                        {isGlobalLoading ? (
                            <div className="flex flex-col items-center justify-center py-40 space-y-6">
                                <div className="relative">
                                    <div className="h-16 w-16 rounded-[1.5rem] border-4 border-white/5 border-t-brand-500 animate-spin" />
                                    <History size={24} className="absolute inset-0 m-auto text-brand-400 animate-pulse" />
                                </div>
                                <div className="flex flex-col items-center gap-2">
                                    <p className="text-xs text-brand-400 font-bold uppercase tracking-[0.3em] animate-pulse">Synchronizing Records</p>
                                    <p className="text-[10px] text-white/20 font-mono tracking-widest uppercase">Connecting to ship-mercury.io...</p>
                                </div>
                            </div>
                        ) : (
                            <div className="animate-fade-in duration-700">
                                {activeTab === "purchased" && (
                                    <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
                                        {purchasedArtworks.length > 0 ? (
                                            purchasedArtworks.map(listing => (
                                                <div key={listing.listing_id} className="hover:-translate-y-2 transition-transform duration-500">
                                                    <ListingCard listing={listing} />
                                                </div>
                                            ))
                                        ) : (
                                            <EmptyState
                                                title="Your Vault Awaits"
                                                description="Discover and collect authentic African digital masterpieces to fill your vault."
                                                icon={ShoppingBag}
                                            />
                                        )}
                                    </div>
                                )}

                                {activeTab === "listings" && (
                                    <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
                                        {activeListings.length > 0 ? (
                                            activeListings.map(listing => (
                                                <div key={listing.listing_id} className="hover:-translate-y-2 transition-transform duration-500">
                                                    <ListingCard listing={listing} />
                                                </div>
                                            ))
                                        ) : (
                                            <EmptyState
                                                title="Open Your Shop"
                                                description="Exhibit your creativity to the world by creating your first on-chain listing."
                                                icon={Tag}
                                            />
                                        )}
                                    </div>
                                )}

                                {activeTab === "sold" && (
                                    <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
                                        {soldArtworks.length > 0 ? (
                                            soldArtworks.map(listing => (
                                                <div key={listing.listing_id} className="hover:-translate-y-2 transition-transform duration-500 opacity-80 hover:opacity-100">
                                                    <ListingCard listing={listing} />
                                                </div>
                                            ))
                                        ) : (
                                            <EmptyState
                                                title="Start Your Legacy"
                                                description="When others value your work, your heritage sales will be immortalized here."
                                                icon={TrendingUp}
                                            />
                                        )}
                                    </div>
                                )}

                                {activeTab === "activity" && (
                                    <div className="mx-auto max-w-4xl">
                                        <ActivityTimeline activities={activities} />
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            </WalletGuard>
        </div>
    );
}

function EmptyState({ title, description, icon: Icon }: { title: string, description: string, icon: any }) {
    return (
        <div className="col-span-full flex flex-col items-center justify-center rounded-[3.5rem] bg-midnight-900/50 border-2 border-dashed border-white/5 py-32 px-10 text-center backdrop-blur-sm relative overflow-hidden group">
            <div className="absolute inset-0 tribal-pattern opacity-[0.02] group-hover:opacity-[0.04] transition-opacity duration-500" />
            <div className="relative mb-10 flex h-28 w-28 items-center justify-center rounded-[2.5rem] bg-midnight-950 text-white/10 shadow-inner group-hover:text-brand-500/30 transition-colors duration-500">
                <Icon size={48} />
            </div>
            <h3 className="font-display text-3xl font-bold text-white tracking-tight relative z-10">{title}</h3>
            <p className="mt-4 max-w-sm text-sm text-brand-300/40 leading-relaxed font-medium relative z-10">
                {description}
            </p>
        </div>
    );
}

function ActivityTimeline({ activities }: { activities: ActivityEvent[] }) {
    if (activities.length === 0) {
        return (
            <EmptyState
                title="Chronicle is Empty"
                description="Every interaction you make on Afristore is recorded on the blockchain and will appear in this timeline."
                icon={Clock}
            />
        );
    }

    return (
        <div className="rounded-[3rem] bg-midnight-900/40 backdrop-blur-md p-8 sm:p-10 border border-white/10 relative overflow-hidden">
            <div className="absolute top-0 right-0 left-0 tribal-strip h-1.5 opacity-20 pointer-events-none" />

            <div className="mb-12 flex flex-col sm:flex-row items-center justify-between gap-6">
                <h3 className="font-display text-3xl font-bold text-white flex items-center gap-4">
                    <div className="h-12 w-12 rounded-2xl bg-brand-500/10 flex items-center justify-center text-brand-400 shadow-xl shadow-brand-500/5">
                        <History size={26} />
                    </div>
                    Recent History
                </h3>
                <div className="flex flex-col items-center sm:items-end gap-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-mint-400 bg-mint-500/5 px-5 py-2.5 rounded-full border border-mint-500/10 backdrop-blur-lg">
                        Network Status: Synchronized
                    </p>
                    <p className="text-[9px] font-mono text-white/20 uppercase tracking-widest">Source: mercury-indexer.v1.0.4</p>
                </div>
            </div>

            <div className="space-y-10 relative">
                {activities.map((item, idx) => (
                    <div key={item.id} className="relative flex items-start gap-8 group">
                        {/* Thread Line */}
                        {idx !== activities.length - 1 && (
                            <div className="absolute left-6 top-14 bottom-[-40px] w-px bg-white/5 group-hover:bg-brand-500/20 transition-colors duration-500" />
                        )}

                        {/* Status Icon Wrapper */}
                        <div className={clsx(
                            "flex h-12 w-12 shrink-0 items-center justify-center rounded-[1.2rem] shadow-2xl z-10 border transition-all duration-500 group-hover:scale-110 group-hover:rotate-12",
                            item.type === "PURCHASE" ? "bg-mint-500/10 text-mint-400 border-mint-500/20 shadow-mint-500/10" :
                                item.type === "SALE" ? "bg-brand-500/10 text-brand-400 border-brand-500/20 shadow-brand-500/10" :
                                    item.type === "ROYALTY" ? "bg-indigo-500/10 text-indigo-400 border-indigo-500/20 shadow-indigo-500/10" :
                                        "bg-white/5 text-white/40 border-white/5"
                        )}>
                            {item.type === "PURCHASE" ? <ShoppingBag size={22} /> :
                                item.type === "SALE" ? <TrendingUp size={22} /> :
                                    item.type === "ROYALTY" ? <Award size={22} /> :
                                        <Package size={22} />}
                        </div>

                        {/* Interaction Card */}
                        <div className="flex-1 rounded-[2.5rem] bg-white/[0.03] hover:bg-white/[0.07] hover:border-white/10 transition-all duration-500 border border-white/5 p-7 group/card shadow-2xl shadow-black/20">
                            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6">
                                <div>
                                    <div className="flex items-center gap-3 mb-2.5">
                                        <span className={clsx(
                                            "text-[9px] font-bold uppercase tracking-[0.2em] px-3 py-1 rounded-lg border",
                                            item.type === "PURCHASE" ? "bg-mint-500/10 text-mint-400 border-mint-500/20" :
                                                item.type === "SALE" ? "bg-brand-500/10 text-brand-400 border-brand-500/20" :
                                                    "bg-white/5 text-white/40 border-white/10"
                                        )}>
                                            {item.type}
                                        </span>
                                        <span className="text-[9px] font-mono text-white/20 tracking-tighter">REF_{item.id.toUpperCase()}</span>
                                    </div>
                                    <p className="font-display text-xl font-bold text-white transition-colors group-hover/card:text-brand-400">{item.title}</p>
                                </div>
                                <div className="text-left sm:text-right flex flex-col items-start sm:items-end">
                                    <p className="font-mono text-xl font-bold text-white tracking-tight">{item.price} <span className="text-[10px] text-brand-400 uppercase font-sans tracking-widest">XLM</span></p>
                                    <div className="text-[10px] text-white/20 mt-2.5 flex items-center gap-2 font-bold uppercase tracking-widest">
                                        <Clock size={12} className="text-brand-400/40" />
                                        <span className="group-hover/card:text-white/40 transition-colors">
                                            {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} • {new Date(item.timestamp).toLocaleDateString()}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            {/* Action Footer */}
                            <div className="mt-7 flex flex-wrap items-center justify-between pt-5 border-t border-white/[0.04] gap-6">
                                <div className="flex items-center gap-3 bg-midnight-950/50 px-4 py-2 rounded-xl border border-white/5">
                                    <div className={clsx(
                                        "h-2 w-2 rounded-full shadow-[0_0_8px_rgba(255,255,255,0.1)]",
                                        item.type === "PURCHASE" ? "bg-mint-400" : "bg-brand-400"
                                    )} />
                                    <span className="text-[10px] font-mono text-white/40 tracking-tight lowercase">{item.tx_hash.slice(0, 24)}…</span>
                                </div>
                                <button className="flex items-center gap-2 text-[10px] font-bold text-mint-400 hover:text-mint-300 hover:underline transition-all group/btn uppercase tracking-widest">
                                    View On Explorer <ExternalLink size={14} className="group-hover/btn:translate-x-0.5 group-hover/btn:-translate-y-0.5 transition-transform duration-300" />
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
