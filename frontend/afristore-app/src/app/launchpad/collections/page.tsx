"use client";

import { useState } from "react";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";
import { useLaunchpadCollections } from "@/hooks/useLaunchpad";
import { CollectionKind } from "@/lib/launchpad";
import { Loader2, Search, Filter, Rocket, ExternalLink } from "lucide-react";
import { useTranslation } from "react-i18next";

export default function CollectionsDirectoryPage() {
  const { t } = useTranslation();
  const { collections, isLoading, error, refresh } = useLaunchpadCollections();
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<CollectionKind | "All">("All");

  const filtered = collections.filter((c) => {
    const matchesSearch =
      c.address.toLowerCase().includes(search.toLowerCase()) ||
      c.creator.toLowerCase().includes(search.toLowerCase());
    const matchesKind = kindFilter === "All" || c.kind === kindFilter;
    return matchesSearch && matchesKind;
  });

  return (
    <main className="min-h-screen bg-brand-50/20">
      <Navbar />

      <div className="pt-24 pb-12">
        <div className="max-w-7xl mx-auto px-4">
          <header className="mb-12">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
              <div className="space-y-2">
                <span className="inline-block px-4 py-1.5 rounded-full bg-brand-100 text-brand-600 text-sm font-bold uppercase tracking-widest">
                  {t("explore")}
                </span>
                <h1 className="text-5xl font-display font-black text-gray-900">
                  {t("launchedCollections")}
                </h1>
                <p className="text-gray-500 max-w-2xl font-inter text-lg">
                  {t("discoverAndMint")}
                </p>
              </div>
              <Link
                href="/launchpad/create"
                className="flex items-center gap-2 rounded-2xl bg-brand-500 px-6 py-4 text-lg font-bold text-white hover:bg-brand-600 shadow-xl shadow-brand-500/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                <Rocket size={20} /> {t("createYours")}
              </Link>
            </div>
          </header>

          {/* Filters */}
          <div className="flex flex-col md:flex-row gap-4 mb-10">
            <div className="relative flex-1">
              <Search
                className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400"
                size={20}
              />
              <input
                type="text"
                placeholder={t("searchByAddress")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-12 pr-4 py-4 rounded-2xl border border-gray-200 bg-white focus:border-brand-500 focus:outline-none transition-all shadow-sm font-inter"
              />
            </div>
            <div className="flex gap-2">
              <select
                value={kindFilter}
                aria-label="Filter by collection type"
                onChange={(e) => setKindFilter(e.target.value as any)}
                className="appearance-none pl-4 pr-10 py-4 rounded-2xl border border-gray-200 bg-white focus:border-brand-500 focus:outline-none transition-all shadow-sm font-inter font-semibold text-gray-700"
              >
                <option value="All">{t("allTypes")}</option>
                <option value="Normal721">{t("normal721")}</option>
                <option value="Normal1155">{t("normal1155")}</option>
                <option value="LazyMint721">{t("lazy721")}</option>
                <option value="LazyMint1155">{t("lazy1155")}</option>
              </select>
            </div>
          </div>

          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <Loader2 size={48} className="animate-spin text-brand-500" />
              <p className="text-gray-500 font-medium font-inter">
                {t("loadingCollections")}
              </p>
            </div>
          ) : error ? (
            <div className="rounded-3xl bg-red-50 p-12 text-center border border-red-100">
              <p className="text-red-600 font-bold mb-4">{error}</p>
              <button
                onClick={refresh}
                className="px-6 py-2 rounded-xl bg-red-100 text-red-700 font-bold hover:bg-red-200 transition-colors"
              >
                {t("tryAgain")}
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-3xl bg-white p-20 text-center border border-gray-100 shadow-sm">
              <p className="text-gray-400 text-lg font-inter">
                {t("noCollectionsFound")}
              </p>
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
                  <div className="space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400 font-inter">{t("creator")}</span>
                      <span className="text-gray-700 font-mono font-medium truncate ml-4 w-32 text-right">
                        {c.creator.slice(0, 4)}...{c.creator.slice(-4)}
                      </span>
                    </div>
                  </div>
                  <Link
                    href={`/launchpad/collections/${c.address}`}
                    className="mt-6 block w-full text-center py-3 rounded-2xl bg-gray-50 text-gray-900 font-bold hover:bg-brand-500 hover:text-white transition-all"
                  >
                    {t("viewDetails")}
                  </Link>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
