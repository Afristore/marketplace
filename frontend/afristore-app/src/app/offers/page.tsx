// ─────────────────────────────────────────────────────────────
// app/offers/page.tsx — Offerer Dashboard
// ─────────────────────────────────────────────────────────────

"use client";

import { useState } from "react";
import Link from "next/link";
import { useWalletContext } from "@/context/WalletContext";
import { useOffererOffers, useWithdrawOffer } from "@/hooks/useOffers";
import { stroopsToXlm, Offer } from "@/lib/contract";
import { ShoppingCart, Clock, CheckCircle, XCircle } from "lucide-react";

type Tab = "all" | "Pending" | "Accepted" | "Rejected" | "Withdrawn";

const STATUS_COLOR: Record<string, string> = {
  Pending: "text-yellow-500 bg-yellow-50",
  Accepted: "text-green-600 bg-green-50",
  Rejected: "text-red-500 bg-red-50",
  Withdrawn: "text-gray-500 bg-gray-100",
};

import { WalletGuard } from "@/components/WalletGuard";

export default function OffersPage() {
  const { publicKey } = useWalletContext();
  const { offers, isLoading, error, refresh } = useOffererOffers(publicKey);
  const { withdraw, isWithdrawing, error: withdrawError } = useWithdrawOffer(publicKey);
  const [tab, setTab] = useState<Tab>("all");

  const pendingCnt = offers.filter((o: Offer) => o.status === "Pending").length;
  const acceptedCnt = offers.filter((o: Offer) => o.status === "Accepted").length;

  const filtered =
    tab === "all" ? offers : offers.filter((o: Offer) => o.status === tab);

  const tabs: { key: Tab; label: string }[] = [
    { key: "all", label: "All" },
    { key: "Pending", label: "Pending" },
    { key: "Accepted", label: "Accepted" },
    { key: "Rejected", label: "Rejected" },
    { key: "Withdrawn", label: "Withdrawn" },
  ];

  return (
    <WalletGuard actionName="To access your offers dashboard">
      <div>
        <div className="mb-8">
          <h1 className="text-3xl font-display font-bold text-gray-900">
            My Offers
          </h1>
          <p className="mt-1 font-mono text-sm text-gray-400">
            {publicKey}
          </p>
        </div>

        {/* Stats */}
        <div className="mb-8 grid gap-4 sm:grid-cols-3">
          {[
            { label: "Total Offers", value: offers.length, icon: ShoppingCart },
            { label: "Pending", value: pendingCnt, icon: Clock },
            { label: "Accepted", value: acceptedCnt, icon: CheckCircle },
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
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`pb-3 px-1 text-sm font-medium transition-colors border-b-2 ${
                tab === key
                  ? "border-brand-500 text-brand-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Error banners */}
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}
        {withdrawError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {withdrawError}
          </div>
        )}

        {/* Content */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-100" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <p className="text-lg font-medium">
              {tab === "all" ? "No offers yet." : `No ${tab.toLowerCase()} offers.`}
            </p>
            {tab === "all" && (
              <Link
                href="/"
                className="mt-4 inline-block rounded-lg bg-brand-500 px-5 py-2 text-sm font-medium text-white hover:bg-brand-600"
              >
                Browse listings
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-100">
              <thead className="bg-gray-50 text-xs font-medium uppercase text-gray-400">
                <tr>
                  <th className="px-5 py-3 text-left">Offer ID</th>
                  <th className="px-5 py-3 text-left">Listing</th>
                  <th className="px-5 py-3 text-right">Amount</th>
                  <th className="px-5 py-3 text-center">Status</th>
                  <th className="px-5 py-3 text-left">Created</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((o: Offer) => (
                  <tr key={o.offer_id} className="text-sm">
                    <td className="px-5 py-3 font-mono text-gray-500">
                      #{o.offer_id}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs">
                      <Link
                        href={`/listing/${o.listing_id}`}
                        className="text-brand-500 hover:text-brand-600 hover:underline"
                      >
                        #{o.listing_id}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-right font-semibold text-gray-800">
                      {stroopsToXlm(o.amount)} XLM
                    </td>
                    <td className="px-5 py-3 text-center">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          STATUS_COLOR[o.status] ?? ""
                        }`}
                      >
                        {o.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs text-gray-400">
                      {new Date(o.created_at * 1000).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-3 text-right">
                      {o.status === "Pending" && (
                        <button
                          onClick={async () => {
                            const ok = await withdraw(o.offer_id);
                            if (ok) refresh();
                          }}
                          disabled={isWithdrawing}
                          className="flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-xs text-red-500 hover:bg-red-50 disabled:opacity-50"
                        >
                          <XCircle size={12} />
                          Withdraw
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </WalletGuard>
  );
}
