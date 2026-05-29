"use client";

import { use } from "react";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { useCollectionDetail } from "@/hooks/useLaunchpad";
import { useWalletContext } from "@/context/WalletContext";
import { Loader2, ShieldCheck, User, Percent, Database, Package, ArrowLeft, Plus } from "lucide-react";

export default function CollectionDetailClient({ address }: { address: string }) {
  const { metadata, isLoading, error } = useCollectionDetail(address);
  const { publicKey } = useWalletContext();

  const isCreator = publicKey === metadata?.creator;

  return (
    <main className="min-h-screen bg-brand-50/20">
      <Navbar />

      <div className="pt-24 pb-12">
        <div className="max-w-7xl mx-auto px-4">
          <Link
            href="/launchpad/collections"
            className="inline-flex items-center gap-2 text-gray-500 hover:text-brand-500 font-bold transition-colors mb-8 group"
          >
            <div className="p-2 rounded-xl bg-white border border-gray-100 group-hover:border-brand-100 transition-all">
              <ArrowLeft size={20} />
            </div>
            Back to Directory
          </Link>

          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <Loader2 size={48} className="animate-spin text-brand-500" />
              <p className="text-gray-500 font-medium font-inter">Fetching collection state...</p>
            </div>
          ) : error ? (
            <div className="rounded-3xl bg-red-50 p-12 text-center border border-red-100">
              <p className="text-red-600 font-bold mb-2">Error loading collection</p>
              <p className="text-red-500 text-sm mb-4">{error}</p>
            </div>
          ) : metadata ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-8">
                <div className="bg-white rounded-3xl border border-gray-100 p-8 md:p-12 shadow-sm">
                  <div className="flex flex-wrap items-center gap-3 mb-6">
                    <span className="px-4 py-1.5 rounded-full bg-brand-100 text-brand-700 text-xs font-black uppercase tracking-widest">
                      Active Collection
                    </span>
                    <span className="px-4 py-1.5 rounded-full bg-blue-100 text-blue-700 text-xs font-black uppercase tracking-widest">
                      {metadata.symbol || "ERC-1155"}
                    </span>
                  </div>
                  <h1 className="text-5xl font-display font-black text-gray-900 mb-6 leading-tight">
                    {metadata.name}
                  </h1>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-6 border-t border-gray-50">
                    <div className="flex items-center gap-4">
                      <div className="p-3 rounded-2xl bg-gray-50 text-gray-400">
                        <User size={24} />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest font-inter">Creator</p>
                        <p className="font-mono text-sm font-medium text-gray-900 truncate w-48">
                          {metadata.creator}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="p-3 rounded-2xl bg-gray-50 text-gray-400">
                        <ShieldCheck size={24} />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest font-inter">Contract Address</p>
                        <p className="font-mono text-sm font-medium text-gray-900 truncate w-48">
                          {address}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-white rounded-3xl border border-gray-100 p-8 shadow-sm">
                  <h3 className="text-2xl font-display font-bold text-gray-900 mb-6">Inventory</h3>
                  <div className="flex flex-col items-center justify-center py-12 text-center bg-gray-50/50 rounded-2xl border border-dashed border-gray-200">
                    <div className="p-4 rounded-full bg-white mb-4">
                      <Package size={32} className="text-gray-300" />
                    </div>
                    <p className="text-gray-500 font-inter">No items found in this collection yet.</p>
                  </div>
                </div>
              </div>

              <div className="space-y-6">
                <div className="bg-white rounded-3xl border border-gray-100 p-8 shadow-sm">
                  <h3 className="text-xl font-display font-bold text-gray-900 mb-6">Collection Stats</h3>
                  <div className="space-y-6">
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-3 text-gray-500">
                        <Database size={20} />
                        <span className="font-inter font-medium">Supply</span>
                      </div>
                      <span className="font-display font-bold text-gray-900">
                        {metadata.totalSupply} / {metadata.maxSupply === 0 ? "∞" : metadata.maxSupply}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-3 text-gray-500">
                        <Percent size={20} />
                        <span className="font-inter font-medium">Royalty</span>
                      </div>
                      <span className="font-display font-bold text-gray-900">
                        {(metadata.royaltyBps / 100).toFixed(1)}%
                      </span>
                    </div>
                  </div>

                  <div className="mt-10 pt-8 border-t border-gray-50 space-y-3">
                    <p className="text-sm font-bold text-gray-400 uppercase tracking-widest font-inter">Mint &amp; redeem</p>
                    <Link
                      href={`/launchpad/collections/${address}/mint`}
                      className="w-full flex items-center justify-center gap-2 rounded-2xl bg-brand-500 py-4 text-white font-bold hover:bg-brand-600 transition-all shadow-lg shadow-brand-500/20"
                    >
                      <Plus size={20} />
                      Open mint / redeem
                    </Link>
                    {isCreator && (
                      <p className="text-xs text-gray-500 font-inter text-center">
                        As the creator you can mint on normal collections; lazy collections use signed vouchers.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}
