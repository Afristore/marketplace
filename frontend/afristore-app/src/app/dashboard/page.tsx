// ─────────────────────────────────────────────────────────────
// app/dashboard/page.tsx — Artist Dashboard
// ─────────────────────────────────────────────────────────────

"use client";

import { useState } from "react";
import { useWalletContext } from "@/context/WalletContext";
import { useArtistListings, useCancelListing } from "@/hooks/useMarketplace";
import { ListingForm } from "@/components/ListingForm";
import { stroopsToXlm, Listing } from "@/lib/contract";
import { Plus, Package, XCircle, Wallet, Edit2 } from "lucide-react";
import { WalletGuard } from "@/components/WalletGuard";
import { SUPPORTED_TOKENS } from "@/config/tokens";

type Tab = "listings" | "list" | "edit";

const STATUS_COLOR: Record<string, string> = {
  Active: "text-green-600 bg-green-50",
  Sold: "text-gray-500 bg-gray-100",
  Cancelled: "text-red-500 bg-red-50",
};

export default function DashboardPage() {
  const { publicKey } = useWalletContext();
  const { listings, isLoading, refresh } = useArtistListings(publicKey);
  const { cancel, isCancelling } = useCancelListing(publicKey);
  const [tab, setTab] = useState<Tab>("listings");
  const [editingListing, setEditingListing] = useState<Listing | null>(null);

  const activeCnt = listings.filter((l: Listing) => l.status === "Active").length;
  const soldCnt = listings.filter((l: Listing) => l.status === "Sold").length;

  const getTokenSymbol = (address: string) => {
    return SUPPORTED_TOKENS.find(t => t.address === address)?.symbol || "Tokens";
  };

  return (
    <WalletGuard actionName="To access your artist dashboard">
      <div>
        <div className="mb-10">
          <h1 className="text-4xl font-display font-bold text-gray-900">
            Artist Dashboard
          </h1>
          <p className="mt-2 font-mono text-sm text-brand-600/60 bg-brand-50/50 inline-block px-3 py-1 rounded-full">
            {publicKey}
          </p>
        </div>

        {/* Stats */}
        <div className="mb-12 grid gap-6 sm:grid-cols-3">
          {[
            { label: "Total Artworks", value: listings.length, icon: Package },
            { label: "Available Now", value: activeCnt, icon: Package },
            { label: "Successful Sales", value: soldCnt, icon: Package },
          ].map(({ label, value, icon: Icon }) => (
            <div
              key={label}
              className="rounded-3xl border border-brand-100 bg-white p-6 shadow-xl shadow-brand-900/5 hover:scale-[1.02] transition-transform"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-500 uppercase tracking-wider">{label}</p>
                <div className="rounded-full bg-brand-50 p-2">
                    <Icon size={20} className="text-brand-500" />
                </div>
              </div>
              <p className="mt-4 text-4xl font-display font-bold text-gray-900">{value}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="mb-10 flex gap-8 border-b border-gray-100">
          <button
            onClick={() => setTab("listings")}
            className={`pb-4 px-2 text-base font-bold transition-all border-b-2 ${tab === "listings"
              ? "border-brand-500 text-brand-600"
              : "border-transparent text-gray-400 hover:text-gray-600"
              }`}
          >
            Gallery
          </button>
          <button
            onClick={() => setTab("list")}
            className={`flex items-center gap-2 pb-4 px-2 text-base font-bold transition-all border-b-2 ${tab === "list"
              ? "border-brand-500 text-brand-600"
              : "border-transparent text-gray-400 hover:text-gray-600"
              }`}
          >
            <Plus size={18} />
            New Listing
          </button>
          {tab === "edit" && (
            <button
                className="pb-4 px-2 text-base font-bold transition-all border-b-2 border-brand-500 text-brand-600"
            >
                Edit Listing #{editingListing?.listing_id}
            </button>
          )}
        </div>

        {/* Tab content */}
        {tab === "list" ? (
          <div className="w-full">
            <ListingForm
              onSuccess={() => {
                refresh();
                setTab("listings");
              }}
              onCancel={() => setTab("listings")}
            />
          </div>
        ) : tab === "edit" ? (
            <div className="w-full">
              {editingListing && (
                <ListingForm
                  listing={editingListing}
                  onSuccess={() => {
                    refresh();
                    setTab("listings");
                    setEditingListing(null);
                  }}
                  onCancel={() => {
                    setTab("listings");
                    setEditingListing(null);
                  }}
                />
              )}
            </div>
        ) : (
          <>
            {isLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-24 animate-pulse rounded-3xl bg-gray-50 border border-gray-100" />
                ))}
              </div>
            ) : listings.length === 0 ? (
              <div className="py-24 text-center rounded-3xl border-2 border-dashed border-gray-200 bg-gray-50/30">
                <div className="mx-auto w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center mb-6">
                    <Package size={40} className="text-gray-300" />
                </div>
                <h3 className="text-2xl font-display font-bold text-gray-900 mb-2">No listings yet.</h3>
                <p className="text-gray-500 font-inter mb-8">Start your journey by creating your first listing.</p>
                <button
                  onClick={() => setTab("list")}
                  className="rounded-2xl bg-brand-500 px-8 py-3.5 text-lg font-bold text-white hover:bg-brand-600 shadow-xl shadow-brand-500/20 transition-all hover:scale-[1.02]"
                >
                  Create your first listing
                </button>
              </div>
            ) : (
              <div className="overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-2xl shadow-brand-900/5">
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-100">
                    <thead className="bg-gray-50/50">
                        <tr>
                        <th className="px-8 py-5 text-left text-xs font-bold uppercase tracking-widest text-gray-400">Identity</th>
                        <th className="px-8 py-5 text-left text-xs font-bold uppercase tracking-widest text-gray-400">CID Record</th>
                        <th className="px-8 py-5 text-right text-xs font-bold uppercase tracking-widest text-gray-400">Pricing</th>
                        <th className="px-8 py-5 text-center text-xs font-bold uppercase tracking-widest text-gray-400">Status</th>
                        <th className="px-8 py-5" />
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                        {listings.map((l: Listing) => (
                        <tr key={l.listing_id} className="text-base group hover:bg-brand-50/10 transition-colors">
                            <td className="px-8 py-6 font-bold text-gray-900">
                            #{l.listing_id}
                            </td>
                            <td className="px-8 py-6 font-mono text-sm text-gray-400">
                            {l.metadata_cid.slice(0, 20)}…
                            </td>
                            <td className="px-8 py-6 text-right whitespace-nowrap">
                            <span className="font-bold text-gray-900 text-lg">
                                {stroopsToXlm(l.price)}
                            </span>
                            <span className="ml-1.5 text-sm font-bold text-brand-600 uppercase">
                                {getTokenSymbol(l.token)}
                            </span>
                            </td>
                            <td className="px-8 py-6 text-center">
                            <span
                                className={`rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-wider ${STATUS_COLOR[l.status] ?? ""}`}
                            >
                                {l.status}
                            </span>
                            </td>
                            <td className="px-8 py-6 text-right">
                            <div className="flex justify-end gap-3 opacity-0 group-hover:opacity-100 transition-opacity">
                                {l.status === "Active" && (
                                <>
                                    <button
                                    onClick={() => {
                                        setEditingListing(l);
                                        setTab("edit");
                                    }}
                                    className="flex items-center gap-2 rounded-xl border border-brand-200 bg-white px-4 py-2 text-sm font-bold text-brand-600 hover:bg-brand-500 hover:text-white hover:border-brand-500 transition-all shadow-sm"
                                    >
                                    <Edit2 size={16} />
                                    Edit
                                    </button>
                                    <button
                                    onClick={async () => {
                                        await cancel(l.listing_id);
                                        refresh();
                                    }}
                                    disabled={isCancelling}
                                    className="flex items-center gap-2 rounded-xl border border-red-100 bg-white px-4 py-2 text-sm font-bold text-red-500 hover:bg-red-500 hover:text-white hover:border-red-500 transition-all shadow-sm disabled:opacity-50"
                                    >
                                    <XCircle size={16} />
                                    Cancel
                                    </button>
                                </>
                                )}
                            </div>
                            </td>
                        </tr>
                        ))}
                    </tbody>
                    </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </WalletGuard>
  );
}

