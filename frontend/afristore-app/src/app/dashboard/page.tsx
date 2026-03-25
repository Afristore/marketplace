// ─────────────────────────────────────────────────────────────
// app/dashboard/page.tsx — Artist Dashboard
// ─────────────────────────────────────────────────────────────

"use client";

import { useState } from "react";
import { useWalletContext } from "@/context/WalletContext";
import { useArtistListings, useCancelListing } from "@/hooks/useMarketplace";
import { UploadArtworkForm } from "@/components/UploadArtworkForm";
import { stroopsToXlm, Listing } from "@/lib/contract";
import { Plus, Package, XCircle, Wallet } from "lucide-react";

type Tab = "listings" | "list";

const STATUS_COLOR: Record<string, string> = {
  Active: "text-green-600 bg-green-50",
  Sold: "text-gray-500 bg-gray-100",
  Cancelled: "text-red-500 bg-red-50",
};

import { WalletGuard } from "@/components/WalletGuard";

export default function DashboardPage() {
  const { publicKey } = useWalletContext();
  const { listings, isLoading, refresh } = useArtistListings(publicKey);
  const { cancel, isCancelling } = useCancelListing(publicKey);
  const [tab, setTab] = useState<Tab>("listings");

  const activeCnt = listings.filter((l: Listing) => l.status === "Active").length;
  const soldCnt = listings.filter((l: Listing) => l.status === "Sold").length;

  return (
    <WalletGuard actionName="To access your artist dashboard">
      <div>
        <div className="mb-8">

          <h1 className="text-3xl font-display font-bold text-gray-900">
            Artist Dashboard
          </h1>
          <p className="mt-1 font-mono text-sm text-gray-400">
            {publicKey}
          </p>
        </div>

        {/* Stats */}
        <div className="mb-8 grid gap-4 sm:grid-cols-3">
          {[
            { label: "Total Listings", value: listings.length, icon: Package },
            { label: "Active", value: activeCnt, icon: Package },
            { label: "Sold", value: soldCnt, icon: Package },
          ].map(({ label, value, icon: Icon }) => (
            <div
              key={label}
              className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-500">{label}</p>
                <Icon size={18} className="text-brand-400" />
              </div>
              <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="mb-6 flex gap-2 border-b border-gray-200">
          <button
            onClick={() => setTab("listings")}
            className={`pb-3 px-1 text-sm font-medium transition-colors border-b-2 ${tab === "listings"
              ? "border-brand-500 text-brand-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
          >
            My Listings
          </button>
          <button
            onClick={() => setTab("list")}
            className={`flex items-center gap-1.5 pb-3 px-1 text-sm font-medium transition-colors border-b-2 ${tab === "list"
              ? "border-brand-500 text-brand-600"
              : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
          >
            <Plus size={14} />
            New Listing
          </button>
        </div>

        {/* Tab content */}
        {tab === "list" ? (
          <div className="max-w-lg mx-auto">
            <UploadArtworkForm
              onSuccess={() => {
                refresh();
                setTab("listings");
              }}
            />
          </div>
        ) : (
          <>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-100" />
                ))}
              </div>
            ) : listings.length === 0 ? (
              <div className="py-16 text-center text-gray-400">
                <p className="text-lg font-medium">No listings yet.</p>
                <button
                  onClick={() => setTab("list")}
                  className="mt-4 rounded-lg bg-brand-500 px-5 py-2 text-sm font-medium text-white hover:bg-brand-600"
                >
                  Create your first listing
                </button>
              </div>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
                <table className="min-w-full divide-y divide-gray-100">
                  <thead className="bg-gray-50 text-xs font-medium uppercase text-gray-400">
                    <tr>
                      <th className="px-5 py-3 text-left">ID</th>
                      <th className="px-5 py-3 text-left">CID</th>
                      <th className="px-5 py-3 text-right">Price</th>
                      <th className="px-5 py-3 text-center">Status</th>
                      <th className="px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {listings.map((l: Listing) => (
                      <tr key={l.listing_id} className="text-sm">
                        <td className="px-5 py-3 font-mono text-gray-500">
                          #{l.listing_id}
                        </td>
                        <td className="px-5 py-3 font-mono text-xs text-gray-400">
                          {l.metadata_cid.slice(0, 14)}…
                        </td>
                        <td className="px-5 py-3 text-right font-semibold text-gray-800">
                          {stroopsToXlm(l.price)} XLM
                        </td>
                        <td className="px-5 py-3 text-center">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_COLOR[l.status] ?? ""}`}
                          >
                            {l.status}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          {l.status === "Active" && (
                            <button
                              onClick={async () => {
                                await cancel(l.listing_id);
                                refresh();
                              }}
                              disabled={isCancelling}
                              className="flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-xs text-red-500 hover:bg-red-50 disabled:opacity-50"
                            >
                              <XCircle size={12} />
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </WalletGuard>
  );
}

