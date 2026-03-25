// -----------------------------------------------------------------
// app/offers/incoming/page.tsx -- Owner Offer Inbox
// -----------------------------------------------------------------

"use client";

import { useWalletContext } from "@/context/WalletContext";
import { useIncomingOffers, useAcceptOffer, useRejectOffer } from "@/hooks/useOffers";
import { stroopsToXlm, Offer, Listing } from "@/lib/contract";
import { Inbox, Clock, CheckCircle, XCircle } from "lucide-react";

const STATUS_COLOR: Record<string, string> = {
  Pending: "text-yellow-500 bg-yellow-50",
  Accepted: "text-green-600 bg-green-50",
  Rejected: "text-red-500 bg-red-50",
  Withdrawn: "text-gray-500 bg-gray-100",
};

import { WalletGuard } from "@/components/WalletGuard";

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

  return (
    <WalletGuard actionName="To access your offer inbox">
      <div>
        <div className="mb-8">
          <h1 className="text-3xl font-display font-bold text-gray-900">
            Offer Inbox
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage incoming offers on your artworks
          </p>
        </div>

        {/* Stats */}
        <div className="mb-8 grid gap-4 sm:grid-cols-3">
          {[
            { label: "Total Incoming", value: allOffers.length, icon: Inbox },
            { label: "Pending Review", value: pendingCnt, icon: Clock },
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

        {/* Error banners */}
        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}
        {acceptError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {acceptError}
          </div>
        )}
        {rejectError && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {rejectError}
          </div>
        )}

        {/* Content */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-100" />
            ))}
          </div>
        ) : allOffers.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <p className="text-lg font-medium">No incoming offers yet.</p>
            <p className="mt-2 text-sm">
              When buyers make offers on your artworks, they will appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {offersByListing.map(
              (group: { listing: Listing; offers: Offer[] }) => (
                <div key={group.listing.listing_id}>
                  {/* Listing group header */}
                  <div className="mb-3 rounded-xl bg-gray-50 px-5 py-3 flex items-center gap-3">
                    <span className="text-sm font-semibold text-gray-700">
                      Listing #{group.listing.listing_id}
                    </span>
                    <span className="font-mono text-xs text-gray-400">
                      {group.listing.metadata_cid.slice(0, 14)}...
                    </span>
                    <span className="ml-auto text-xs text-gray-400">
                      {group.offers.length} offer
                      {group.offers.length !== 1 ? "s" : ""}
                    </span>
                  </div>

                  {/* Offers table */}
                  <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
                    <table className="min-w-full divide-y divide-gray-100">
                      <thead className="bg-gray-50 text-xs font-medium uppercase text-gray-400">
                        <tr>
                          <th className="px-5 py-3 text-left">Offerer</th>
                          <th className="px-5 py-3 text-right">Amount</th>
                          <th className="px-5 py-3 text-center">Status</th>
                          <th className="px-5 py-3 text-left">Created</th>
                          <th className="px-5 py-3" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {group.offers.map((o: Offer) => (
                          <tr key={o.offer_id} className="text-sm">
                            <td className="px-5 py-3 font-mono text-xs text-gray-500">
                              {o.offerer.slice(0, 6)}...{o.offerer.slice(-4)}
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
                                <div className="flex items-center justify-end gap-2">
                                  <button
                                    onClick={async () => {
                                      const ok = await accept(o.offer_id);
                                      if (ok) refresh();
                                    }}
                                    disabled={isAccepting || isRejecting}
                                    className="flex items-center gap-1 rounded-lg bg-green-500 px-2.5 py-1 text-xs text-white hover:bg-green-600 disabled:opacity-50"
                                  >
                                    <CheckCircle size={12} />
                                    Accept
                                  </button>
                                  <button
                                    onClick={async () => {
                                      const ok = await reject(o.offer_id);
                                      if (ok) refresh();
                                    }}
                                    disabled={isAccepting || isRejecting}
                                    className="flex items-center gap-1 rounded-lg border border-red-200 px-2.5 py-1 text-xs text-red-500 hover:bg-red-50 disabled:opacity-50"
                                  >
                                    <XCircle size={12} />
                                    Reject
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            )}
          </div>
        )}
      </div>
    </WalletGuard>
  );
}
