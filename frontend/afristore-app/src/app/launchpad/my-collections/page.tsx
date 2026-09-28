"use client";

import { useState } from "react";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { useCreatorCollections } from "@/hooks/useLaunchpad";
import { useWalletContext } from "@/context/WalletContext";
import { useTranslation } from "@/lib/i18n/useTranslation";
import type { TranslationKey } from "@/lib/i18n/translate";
import {
  Loader2,
  Search,
  ExternalLink,
  Plus,
  Palette,
  Crown,
} from "lucide-react";

/** `value` is the on-chain collection kind, `labelKey` is the UI label. */
const KIND_FILTER_OPTIONS: ReadonlyArray<{
  value: string;
  labelKey: TranslationKey;
}> = [
  { value: "All", labelKey: "myCollections.filters.allTypes" },
  { value: "Normal721", labelKey: "myCollections.filters.normal721" },
  { value: "Normal1155", labelKey: "myCollections.filters.normal1155" },
  { value: "LazyMint721", labelKey: "myCollections.filters.lazy721" },
  { value: "LazyMint1155", labelKey: "myCollections.filters.lazy1155" },
];

export default function MyCollectionsPage() {
  const { publicKey, isConnected } = useWalletContext();
  const { collections, isLoading, error, refresh } =
    useCreatorCollections(publicKey);
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<string>("All");

  const filtered = collections.filter((c) => {
    const matchesSearch = c.address
      .toLowerCase()
      .includes(search.toLowerCase());
    const matchesKind = kindFilter === "All" || c.kind === kindFilter;
    return matchesSearch && matchesKind;
  });

  if (!isConnected) {
    return (
      <main className="min-h-screen bg-brand-50/20">
        <Navbar />

        <div className="pt-24 pb-12">
          <div className="max-w-7xl mx-auto px-4">
            <div className="flex flex-col items-center justify-center py-20 gap-6">
              <div className="flex items-center justify-center w-20 h-20 rounded-2xl bg-gray-100">
                <Crown size={40} className="text-gray-400" />
              </div>
              <h1 className="text-5xl font-display font-black text-gray-900 text-center">
                {t("myCollections.disconnected.heading")}
              </h1>
              <p className="text-gray-500 max-w-2xl text-center font-inter text-lg">
                {t("myCollections.disconnected.description")}
              </p>
              <div className="text-center">
                <p className="text-sm text-gray-400 mb-4">
                  {t("myCollections.disconnected.hint")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-brand-50/20">
      <Navbar />

      <div className="pt-24 pb-12">
        <div className="max-w-7xl mx-auto px-4">
          <header className="mb-12">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
              <div className="space-y-2">
                <span className="inline-block px-4 py-1.5 rounded-full bg-brand-100 text-brand-600 text-sm font-bold uppercase tracking-widest">
                  {t("myCollections.badge")}
                </span>
                <h1 className="text-5xl font-display font-black text-gray-900">
                  {t("myCollections.title")}
                </h1>
                <p className="text-gray-500 max-w-2xl font-inter text-lg">
                  {t("myCollections.subtitle")}
                </p>
              </div>
              <Link
                href="/launchpad/create"
                className="flex items-center gap-2 rounded-2xl bg-brand-500 px-6 py-4 text-lg font-bold text-white hover:bg-brand-600 shadow-xl shadow-brand-500/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                <Plus size={20} /> {t("myCollections.createNew")}
              </Link>
            </div>
          </header>

          {/* Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
            <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-brand-100">
                  <Palette size={24} className="text-brand-600" />
                </div>
                <div>
                  <p className="text-2xl font-display font-black text-gray-900">
                    {collections.length}
                  </p>
                  <p className="text-gray-500 font-inter text-sm">
                    {t("myCollections.stats.total")}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-mint-100">
                  <Crown size={24} className="text-mint-600" />
                </div>
                <div>
                  <p className="text-2xl font-display font-black text-gray-900">
                    {collections.filter((c) => c.kind.includes("721")).length}
                  </p>
                  <p className="text-gray-500 font-inter text-sm">
                    {t("myCollections.stats.erc721")}
                  </p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-terracotta-100">
                  <Palette size={24} className="text-terracotta-600" />
                </div>
                <div>
                  <p className="text-2xl font-display font-black text-gray-900">
                    {collections.filter((c) => c.kind.includes("1155")).length}
                  </p>
                  <p className="text-gray-500 font-inter text-sm">
                    {t("myCollections.stats.erc1155")}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-col md:flex-row gap-4 mb-10">
            <div className="relative flex-1">
              <Search
                className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
                size={20}
              />
              <input
                type="text"
                placeholder={t("myCollections.filters.searchPlaceholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-12 pr-4 py-4 rounded-2xl border border-gray-200 bg-white focus:border-brand-500 focus:outline-none transition-all shadow-sm font-inter"
              />
            </div>
            <div className="flex gap-2">
              <select
                value={kindFilter}
                aria-label={t("myCollections.filters.filterByType")}
                onChange={(e) => setKindFilter(e.target.value)}
                className="appearance-none pl-4 pr-10 py-4 rounded-2xl border border-gray-200 bg-white focus:border-brand-500 focus:outline-none transition-all shadow-sm font-inter font-semibold text-gray-700"
              >
                {KIND_FILTER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {t(option.labelKey)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <Loader2 size={48} className="animate-spin text-brand-500" />
              <p className="text-gray-500 font-medium font-inter">
                {t("myCollections.loading")}
              </p>
            </div>
          ) : error ? (
            <div className="rounded-3xl bg-red-50 p-12 text-center border border-red-100">
              <p className="text-red-600 font-bold mb-4">{error}</p>
              <button
                onClick={refresh}
                className="px-6 py-2 rounded-xl bg-red-100 text-red-700 font-bold hover:bg-red-200 transition-colors"
              >
                {t("myCollections.retry")}
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-3xl bg-white p-20 text-center border border-gray-100 shadow-sm">
              <div className="flex flex-col items-center gap-6">
                <div className="flex items-center justify-center w-20 h-20 rounded-2xl bg-gray-100">
                  <Palette size={40} className="text-gray-400" />
                </div>
                <div>
                  <h3 className="text-xl font-display font-bold text-gray-900 mb-2">
                    {collections.length === 0
                      ? t("myCollections.empty.noCollectionsTitle")
                      : t("myCollections.empty.noMatchesTitle")}
                  </h3>
                  <p className="text-gray-500 font-inter">
                    {collections.length === 0
                      ? t("myCollections.empty.noCollectionsDescription")
                      : t("myCollections.empty.noMatchesDescription")}
                  </p>
                </div>
                {collections.length === 0 && (
                  <Link
                    href="/launchpad/create"
                    className="inline-flex items-center gap-2 rounded-2xl bg-brand-500 px-6 py-3 text-lg font-bold text-white hover:bg-brand-600 shadow-xl shadow-brand-500/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
                  >
                    <Plus size={20} />
                    {t("myCollections.empty.createFirst")}
                  </Link>
                )}
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {filtered.map((c) => (
                <div
                  key={c.address}
                  className="group bg-white rounded-3xl border border-gray-100 p-6 shadow-sm hover:shadow-xl hover:shadow-brand-900/5 transition-all hover:-translate-y-1"
                >
                  <div className="flex justify-between items-start mb-4">
                    <span
                      className={`px-3 py-1 rounded-full text-xs font-bold tracking-wider uppercase ${
                        c.kind.startsWith("Lazy")
                          ? "bg-amber-100 text-amber-700"
                          : "bg-brand-100 text-brand-700"
                      }`}
                    >
                      {c.kind}
                    </span>
                    <Link
                      href={`/launchpad/collections/${c.address}`}
                      className="text-gray-400 hover:text-brand-500 transition-colors"
                    >
                      <ExternalLink size={20} />
                    </Link>
                  </div>
                  <h3
                    className="text-xl font-display font-bold text-gray-900 mb-2 truncate"
                    title={c.address}
                  >
                    {c.address.slice(0, 8)}...{c.address.slice(-8)}
                  </h3>
                  <div className="space-y-3 mb-6">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400 font-inter">
                        {t("myCollections.card.type")}
                      </span>
                      <span className="text-gray-700 font-medium">
                        {c.kind.replace("Mint", " Mint")}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400 font-inter">
                        {t("myCollections.card.status")}
                      </span>
                      <span className="text-green-600 font-medium flex items-center gap-1">
                        <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                        {t("myCollections.card.active")}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Link
                      href={`/launchpad/collections/${c.address}`}
                      className="flex-1 text-center py-3 rounded-2xl bg-gray-50 text-gray-900 font-bold hover:bg-brand-500 hover:text-white transition-all"
                    >
                      {t("myCollections.card.viewDetails")}
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
