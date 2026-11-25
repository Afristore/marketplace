// -----------------------------------------------------------------
// app/offers/incoming/page.tsx -- Owner Offer Inbox
// -----------------------------------------------------------------

"use client";

import { useState, useMemo } from "react";
import { useWalletContext } from "@/context/WalletContext";
import {
  useIncomingOffers,
  useAcceptOffer,
  useRejectOffer,
} from "@/hooks/useOffers";
import { Offer, Listing } from "@/lib/contract";
import {
  Inbox,
  CheckCircle,
  XCircle,
  Activity,
  TrendingUp,
  Loader2,
  User,
  History,
  Search,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  Filter,
} from "lucide-react";
import { WalletGuard } from "@/components/WalletGuard";
import { useToast } from "@/components/ToastProvider";
import { resolveOfferTokenDisplay } from "@/config/tokens";
import { clsx } from "clsx";

export default function IncomingOffersPage() {
  const { publicKey } = useWalletContext();
  const { pushToast } = useToast();
  const { offersByListing, isLoading, error, refresh } =
    useIncomingOffers(publicKey);
  const { accept, isAccepting, error: acceptError } = useAcceptOffer(publicKey);
  const { reject, isRejecting, error: rejectError } = useRejectOffer(publicKey);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "Pending" | "Accepted" | "Rejected"
  >("all");
  const [sortOrder, setSortOrder] = useState<"pending" | "newest" | "offers">(
    "pending",
  );
  const [page, setPage] = useState(1);
  const [offerPages, setOfferPages] = useState<Record<number, number>>({});

  const GROUPS_PER_PAGE = 4;
  const OFFERS_PER_PAGE = 6;

  // Flatten all offers for global stats
  const allOffers = useMemo(
    () =>
      offersByListing.flatMap(
        (group: { listing: Listing; offers: Offer[] }) => group.offers,
      ),
    [offersByListing],
  );

  const pendingCnt = useMemo(
    () => allOffers.filter((o: Offer) => o.status === "Pending").length,
    [allOffers],
  );
  const acceptedCnt = useMemo(
    () => allOffers.filter((o: Offer) => o.status === "Accepted").length,
    [allOffers],
  );
  const rejectedCnt = useMemo(
    () => allOffers.filter((o: Offer) => o.status === "Rejected").length,
    [allOffers],
  );

  const handleAccept = async (offerId: number) => {
    try {
      const ok = await accept(offerId);
      if (ok) {
        pushToast("Offer accepted successfully.", "success");
        try {
          await refresh();
        } catch {
          // refresh failure is non-critical
        }
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to accept offer.";
      pushToast(msg, "error");
    }
  };

  const handleReject = async (offerId: number) => {
    try {
      const ok = await reject(offerId);
      if (ok) {
        pushToast("Offer rejected.", "info");
        try {
          await refresh();
        } catch {
          // refresh failure is non-critical
        }
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to reject offer.";
      pushToast(msg, "error");
    }
  };

  // Filter and sort listing groups
  const filteredGroups = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const cleanQ = q.replace(/^#/, "");

    return offersByListing
      .map((group) => {
        let matchingOffers = group.offers;

        // Filter by offer status if requested
        if (statusFilter !== "all") {
          matchingOffers = matchingOffers.filter(
            (o) => o.status === statusFilter,
          );
        }

        // Filter by search query
        if (q) {
          const matchListingId = String(group.listing.listing_id)
            .toLowerCase()
            .includes(cleanQ);
          const matchCid = (group.listing.metadata_cid || "")
            .toLowerCase()
            .includes(q);
          const matchOfferer = matchingOffers.some((o) =>
            o.offerer.toLowerCase().includes(q),
          );

          if (!matchListingId && !matchCid && !matchOfferer) {
            return null;
          }

          if (!matchListingId && !matchCid && matchOfferer) {
            matchingOffers = matchingOffers.filter((o) =>
              o.offerer.toLowerCase().includes(q),
            );
          }
        }

        if (matchingOffers.length === 0 && (statusFilter !== "all" || q)) {
          return null;
        }

        // Sort pending offers first, then newest first
        const sortedOffers = [...matchingOffers].sort((a, b) => {
          if (a.status === "Pending" && b.status !== "Pending") return -1;
          if (a.status !== "Pending" && b.status === "Pending") return 1;
          return b.created_at - a.created_at;
        });

        return {
          listing: group.listing,
          offers: sortedOffers,
        };
      })
      .filter((g): g is { listing: Listing; offers: Offer[] } => g !== null)
      .sort((a, b) => {
        if (sortOrder === "pending") {
          const aPending = a.offers.some((o) => o.status === "Pending");
          const bPending = b.offers.some((o) => o.status === "Pending");
          if (aPending && !bPending) return -1;
          if (!aPending && bPending) return 1;
          return b.listing.listing_id - a.listing.listing_id;
        }
        if (sortOrder === "newest") {
          return b.listing.listing_id - a.listing.listing_id;
        }
        if (sortOrder === "offers") {
          return b.offers.length - a.offers.length;
        }
        return 0;
      });
  }, [offersByListing, searchQuery, statusFilter, sortOrder]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredGroups.length / GROUPS_PER_PAGE),
  );
  const paginatedGroups = filteredGroups.slice(
    (page - 1) * GROUPS_PER_PAGE,
    page * GROUPS_PER_PAGE,
  );

  const handleOfferPageChange = (listingId: number, newPage: number) => {
    setOfferPages((prev) => ({
      ...prev,
      [listingId]: newPage,
    }));
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
                    <Inbox
                      size={56}
                      className="text-brand-400/80 group-hover:text-brand-400 transition-colors"
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-4">
                  <div className="space-y-1">
                    <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-white">
                      Offer <span className="text-brand-400">Inbox</span>
                    </h1>
                    <p className="text-brand-300/60 font-medium text-sm tracking-widest uppercase">
                      Manage incoming requests
                    </p>
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
              {
                label: "Total Received",
                value: allOffers.length,
                icon: History,
                color: "brand",
              },
              {
                label: "Needs Review",
                value: pendingCnt,
                icon: Activity,
                color: "mint",
              },
              {
                label: "Total Accepted",
                value: acceptedCnt,
                icon: TrendingUp,
                color: "terracotta",
              },
            ].map(({ label, value, icon: Icon, color }) => (
              <div
                key={label}
                className={clsx(
                  "group relative rounded-[2.5rem] bg-white/5 border border-white/10 p-6 backdrop-blur-md transition-all duration-500 hover:border-white/20 overflow-hidden shadow-2xl",
                  color === "brand" &&
                  "hover:border-brand-500/30 hover:bg-white/[0.07]",
                  color === "mint" &&
                  "hover:border-mint-500/30 hover:bg-white/[0.07]",
                  color === "terracotta" &&
                  "hover:border-terracotta-500/30 hover:bg-white/[0.07]",
                )}
              >
                <div
                  className={clsx(
                    "absolute top-0 right-0 w-32 h-32 rounded-full blur-3xl transition-colors",
                    color === "brand" &&
                    "bg-brand-500/5 group-hover:bg-brand-500/10",
                    color === "mint" &&
                    "bg-mint-500/5 group-hover:bg-mint-500/10",
                    color === "terracotta" &&
                    "bg-terracotta-500/5 group-hover:bg-terracotta-500/10",
                  )}
                />
                <div className="flex items-center justify-between relative z-10">
                  <p className="text-[10px] uppercase tracking-[0.3em] font-bold text-white/40">
                    {label}
                  </p>
                  <div
                    className={clsx(
                      "rounded-full p-2 border",
                      color === "brand"
                        ? "border-brand-500/20 bg-brand-500/10"
                        : color === "mint"
                          ? "border-mint-500/20 bg-mint-500/10"
                          : "border-terracotta-500/20 bg-terracotta-500/10",
                    )}
                  >
                    <Icon
                      size={16}
                      className={clsx(
                        color === "brand"
                          ? "text-brand-400"
                          : color === "mint"
                            ? "text-mint-400"
                            : "text-terracotta-400",
                      )}
                    />
                  </div>
                </div>
                <p className="mt-4 text-4xl font-display font-bold tracking-tight text-white relative z-10">
                  {value}
                </p>
              </div>
            ))}
          </div>

          {/* Search, Filter & Sort Toolbar */}
          <div className="mb-10 flex flex-col gap-4 rounded-3xl bg-midnight-900/60 border border-white/5 p-4 sm:p-6 backdrop-blur-md">
            <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
              {/* Search Bar */}
              <div className="relative flex-1">
                <Search
                  size={18}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30"
                />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setPage(1);
                  }}
                  placeholder="Search by listing #, metadata CID, or offerer…"
                  className="w-full rounded-2xl bg-white/5 border border-white/10 pl-11 pr-4 py-3 text-sm text-white placeholder-white/30 focus:border-brand-500/50 focus:outline-none focus:ring-1 focus:ring-brand-500/50 transition-all font-mono"
                />
                {searchQuery && (
                  <button
                    onClick={() => {
                      setSearchQuery("");
                      setPage(1);
                    }}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-white/40 hover:text-white px-2 py-1"
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Sort Order Selector */}
              <div className="flex items-center gap-2">
                <ArrowUpDown size={16} className="text-white/40" />
                <span className="text-xs text-white/40 font-bold uppercase tracking-wider hidden sm:inline">
                  Sort:
                </span>
                <select
                  value={sortOrder}
                  onChange={(e) => {
                    setSortOrder(
                      e.target.value as "pending" | "newest" | "offers",
                    );
                    setPage(1);
                  }}
                  className="rounded-2xl bg-midnight-950 border border-white/10 px-4 py-2.5 text-xs font-bold text-white focus:outline-none focus:border-brand-500/50 cursor-pointer"
                >
                  <option value="pending">Pending First</option>
                  <option value="newest">Newest Listing</option>
                  <option value="offers">Most Offers</option>
                </select>
              </div>
            </div>

            {/* Filter Tabs */}
            <div className="flex items-center gap-2 overflow-x-auto pt-2 border-t border-white/5 text-xs">
              <span className="text-white/40 font-bold uppercase tracking-wider mr-2 hidden sm:inline">
                Status:
              </span>
              {[
                { key: "all", label: "All Offers", count: allOffers.length },
                { key: "Pending", label: "Pending", count: pendingCnt },
                { key: "Accepted", label: "Accepted", count: acceptedCnt },
                { key: "Rejected", label: "Rejected", count: rejectedCnt },
              ].map(({ key, label, count }) => (
                <button
                  key={key}
                  onClick={() => {
                    setStatusFilter(
                      key as "all" | "Pending" | "Accepted" | "Rejected",
                    );
                    setPage(1);
                  }}
                  className={clsx(
                    "flex items-center gap-2 px-4 py-2 rounded-xl font-bold transition-all whitespace-nowrap",
                    statusFilter === key
                      ? "bg-brand-500/20 text-brand-400 border border-brand-500/30"
                      : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white border border-transparent",
                  )}
                >
                  <span>{label}</span>
                  <span
                    className={clsx(
                      "px-2 py-0.5 rounded-full text-[10px]",
                      statusFilter === key
                        ? "bg-brand-500/30 text-white"
                        : "bg-white/10 text-white/60",
                    )}
                  >
                    {count}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Error banners — retained as a persistent fallback in addition to toasts */}
          {(error || acceptError || rejectError) && (
            <div
              role="alert"
              className="mb-8 rounded-3xl border border-terracotta-500/20 bg-terracotta-500/5 px-6 py-4 text-sm font-bold text-terracotta-400 backdrop-blur-md flex items-center gap-3 animate-fade-in shadow-xl"
            >
              <XCircle size={20} aria-hidden="true" />
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
                      {[1, 2, 3].map((j) => (
                        <div
                          key={j}
                          className="h-64 rounded-[2.5rem] bg-white/[0.03] border border-white/5"
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : filteredGroups.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-[3.5rem] bg-midnight-900/50 border-2 border-dashed border-white/5 py-32 px-10 text-center backdrop-blur-sm relative overflow-hidden group">
                <div className="absolute inset-0 tribal-pattern opacity-[0.02] group-hover:opacity-[0.04] transition-opacity duration-500" />
                <div className="relative mb-10 flex h-28 w-28 items-center justify-center rounded-[2.5rem] bg-midnight-950 text-white/10 shadow-inner group-hover:text-brand-500/30 transition-colors duration-500">
                  <Inbox size={48} />
                </div>
                <h3 className="font-display text-3xl font-bold text-white tracking-tight relative z-10">
                  {allOffers.length === 0
                    ? "No incoming offers yet."
                    : "No offers match your filter."}
                </h3>
                <p className="mt-4 max-w-sm text-sm text-brand-300/40 leading-relaxed font-medium relative z-10">
                  {allOffers.length === 0
                    ? "When buyers make offers on your artworks, they will appear here grouped by listing."
                    : "Try clearing your search query or choosing another status tab."}
                </p>
                {(searchQuery || statusFilter !== "all") && (
                  <button
                    onClick={() => {
                      setSearchQuery("");
                      setStatusFilter("all");
                      setPage(1);
                    }}
                    className="mt-6 rounded-2xl bg-white/5 hover:bg-white/10 border border-white/10 px-6 py-2.5 text-xs font-bold text-white transition-all"
                  >
                    Clear Filters
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-16">
                {paginatedGroups.map((group) => {
                  const currentOfferPage =
                    offerPages[group.listing.listing_id] || 1;
                  const totalOfferPages = Math.max(
                    1,
                    Math.ceil(group.offers.length / OFFERS_PER_PAGE),
                  );
                  const visibleOffers = group.offers.slice(
                    (currentOfferPage - 1) * OFFERS_PER_PAGE,
                    currentOfferPage * OFFERS_PER_PAGE,
                  );

                  return (
                    <div
                      key={group.listing.listing_id}
                      className="relative group/listing"
                    >
                      {/* Listing Group Header */}
                      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8 pb-4 border-b border-white/5">
                        <div className="flex items-center gap-6">
                          <div className="flex flex-col">
                            <h2 className="font-display text-2xl font-bold text-white tracking-tight">
                              Listing{" "}
                              <span className="text-mint-400">
                                #{group.listing.listing_id}
                              </span>
                            </h2>
                            <p className="text-[10px] font-mono text-white/20 break-all">
                              {group.listing.metadata_cid}
                            </p>
                          </div>
                          <div
                            className={clsx(
                              "px-4 py-1 rounded-full text-[9px] font-bold uppercase tracking-[0.2em] border",
                              group.listing.status === "Active"
                                ? "border-brand-500/30 text-brand-400 bg-brand-500/5"
                                : "border-white/10 text-white/30 bg-white/5",
                            )}
                          >
                            {group.listing.status}
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          <div className="flex items-center gap-2 text-white/30 text-xs font-bold uppercase tracking-widest">
                            <Activity size={14} className="text-mint-500/40" />
                            {group.offers.length} offer
                            {group.offers.length !== 1 ? "s" : ""}
                          </div>

                          {/* Per-Listing Offer Pagination Controls */}
                          {totalOfferPages > 1 && (
                            <div className="flex items-center gap-2 bg-white/5 rounded-xl px-3 py-1 border border-white/10 text-xs">
                              <span className="text-white/40 text-[11px]">
                                Page {currentOfferPage} of {totalOfferPages}
                              </span>
                              <button
                                onClick={() =>
                                  handleOfferPageChange(
                                    group.listing.listing_id,
                                    Math.max(1, currentOfferPage - 1),
                                  )
                                }
                                disabled={currentOfferPage === 1}
                                className="p-1 text-white/60 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                                title="Previous offers"
                              >
                                <ChevronLeft size={14} />
                              </button>
                              <button
                                onClick={() =>
                                  handleOfferPageChange(
                                    group.listing.listing_id,
                                    Math.min(
                                      totalOfferPages,
                                      currentOfferPage + 1,
                                    ),
                                  )
                                }
                                disabled={currentOfferPage === totalOfferPages}
                                className="p-1 text-white/60 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed"
                                title="Next offers"
                              >
                                <ChevronRight size={14} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Offers Grid for this Listing */}
                      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                        {visibleOffers.map((o) => (
                          <div
                            key={o.offer_id}
                            className="group relative flex flex-col rounded-[2.5rem] bg-white/[0.03] hover:bg-white/[0.07] hover:border-white/10 transition-all duration-500 border border-white/5 p-6 shadow-2xl overflow-hidden min-h-[320px]"
                          >
                            {/* BG Tribal Accent */}
                            <div className="absolute -top-10 -right-10 tribal-pattern opacity-[0.02] scale-50 group-hover:scale-75 transition-transform duration-1000" />

                            <div className="flex items-center justify-between mb-8">
                              <div className="flex items-center gap-3">
                                <div className="h-10 w-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center">
                                  <User size={18} className="text-white/20" />
                                </div>
                                <div className="flex flex-col">
                                  <span className="text-[9px] uppercase font-bold text-white/20 tracking-widest">
                                    Offerer
                                  </span>
                                  <span className="text-xs font-mono text-white/60">
                                    {o.offerer.slice(0, 6)}...
                                    {o.offerer.slice(-4)}
                                  </span>
                                </div>
                              </div>
                              <div
                                className={clsx(
                                  "px-3 py-1 rounded-full text-[9px] font-bold uppercase tracking-widest border",
                                  o.status === "Pending"
                                    ? "bg-brand-500/10 text-brand-400 border-brand-500/20"
                                    : o.status === "Accepted"
                                      ? "bg-mint-500/10 text-mint-400 border-mint-500/20"
                                      : "bg-white/5 text-white/30 border-white/10",
                                )}
                              >
                                {o.status}
                              </div>
                            </div>

                            <div className="flex flex-col gap-1 mb-10">
                              <p className="text-[10px] font-bold text-white/40 uppercase tracking-[0.2em]">
                                Offered Price
                              </p>
                              {(() => {
                                const tokenDisplay = resolveOfferTokenDisplay(
                                  o.amount,
                                  o.token,
                                );
                                if (tokenDisplay.isUnknown) {
                                  return (
                                    <div className="flex flex-col gap-1">
                                      <span className="font-mono text-xs sm:text-sm font-semibold text-terracotta-400 break-all">
                                        {tokenDisplay.symbol}
                                      </span>
                                      <span className="text-[11px] text-white/40 font-mono">
                                        Amount: {tokenDisplay.rawAmount}
                                      </span>
                                    </div>
                                  );
                                }
                                return (
                                  <div className="flex items-baseline gap-2">
                                    <span className="font-display text-4xl font-bold text-white">
                                      {tokenDisplay.formattedAmount}
                                    </span>
                                    <span className="text-[11px] font-bold text-brand-400 uppercase tracking-widest">
                                      {tokenDisplay.symbol}
                                    </span>
                                  </div>
                                );
                              })()}
                            </div>

                            <div className="mt-auto space-y-4">
                              <div className="flex items-center justify-between py-4 border-t border-white/5 text-[10px] uppercase font-bold tracking-widest text-white/20">
                                <span>Date Placed</span>
                                <span className="text-white/40">
                                  {new Date(
                                    o.created_at * 1000,
                                  ).toLocaleDateString()}
                                </span>
                              </div>

                              {o.status === "Pending" && (
                                <div className="grid grid-cols-2 gap-3">
                                  <button
                                    onClick={() => handleAccept(o.offer_id)}
                                    disabled={isAccepting || isRejecting}
                                    className="flex items-center justify-center gap-2 rounded-2xl bg-mint-500/20 hover:bg-mint-500/30 py-3.5 text-xs font-bold text-mint-400 border border-mint-500/30 transition-all hover:scale-[1.02] disabled:opacity-50 group/btn"
                                  >
                                    {isAccepting ? (
                                      <Loader2
                                        size={16}
                                        className="animate-spin"
                                      />
                                    ) : (
                                      <>
                                        <CheckCircle
                                          size={16}
                                          className="group-hover/btn:scale-110 transition-transform"
                                        />
                                        Accept
                                      </>
                                    )}
                                  </button>
                                  <button
                                    onClick={() => handleReject(o.offer_id)}
                                    disabled={isAccepting || isRejecting}
                                    className="flex items-center justify-center gap-2 rounded-2xl bg-white/5 hover:bg-terracotta-500/20 py-3.5 text-xs font-bold text-white/60 hover:text-terracotta-400 border border-white/10 hover:border-terracotta-500/30 transition-all disabled:opacity-50 group/rej"
                                  >
                                    {isRejecting ? (
                                      <Loader2
                                        size={16}
                                        className="animate-spin"
                                      />
                                    ) : (
                                      <>
                                        <XCircle
                                          size={16}
                                          className="group-hover/rej:scale-110 transition-transform"
                                        />
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
                  );
                })}

                {/* Group Pagination Controls */}
                {totalPages > 1 && (
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-8 border-t border-white/5">
                    <p className="text-xs text-white/40">
                      Showing listings{" "}
                      <span className="font-semibold text-white">
                        {(page - 1) * GROUPS_PER_PAGE + 1}
                      </span>{" "}
                      to{" "}
                      <span className="font-semibold text-white">
                        {Math.min(
                          page * GROUPS_PER_PAGE,
                          filteredGroups.length,
                        )}
                      </span>{" "}
                      of{" "}
                      <span className="font-semibold text-white">
                        {filteredGroups.length}
                      </span>
                    </p>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page === 1}
                        className="flex items-center gap-1 rounded-xl bg-white/5 hover:bg-white/10 px-4 py-2 text-xs font-bold text-white disabled:opacity-30 disabled:cursor-not-allowed border border-white/10 transition-all"
                      >
                        <ChevronLeft size={16} />
                        Previous
                      </button>

                      <span className="text-xs font-mono text-white/60 px-3">
                        Page {page} of {totalPages}
                      </span>

                      <button
                        onClick={() =>
                          setPage((p) => Math.min(totalPages, p + 1))
                        }
                        disabled={page === totalPages}
                        className="flex items-center gap-1 rounded-xl bg-white/5 hover:bg-white/10 px-4 py-2 text-xs font-bold text-white disabled:opacity-30 disabled:cursor-not-allowed border border-white/10 transition-all"
                      >
                        Next
                        <ChevronRight size={16} />
                      </button>
                    </div>
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
