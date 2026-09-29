// ─────────────────────────────────────────────────────────────
// app/lending/layout.tsx — Lending section layout & navigation
// ─────────────────────────────────────────────────────────────
"use client";

import { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWalletContext } from "@/context/WalletContext";
import { useAdminCheck } from "@/hooks/useAdmin";
import {
  Coins,
  Landmark,
  LayoutDashboard,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import clsx from "clsx";

interface NavTab {
  label: string;
  href: string;
  icon: typeof Coins;
  exact?: boolean;
  adminOnly?: boolean;
}

const NAV_TABS: NavTab[] = [
  {
    label: "Borrow",
    href: "/lending/borrow",
    icon: Coins,
  },
  {
    label: "Lend",
    href: "/lending/lend",
    icon: Landmark,
  },
  {
    label: "Dashboard",
    href: "/lending/dashboard",
    icon: LayoutDashboard,
  },
  {
    label: "Admin",
    href: "/lending/admin",
    icon: ShieldCheck,
    adminOnly: true,
  },
];

export default function LendingLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { publicKey } = useWalletContext();
  const { isAdmin } = useAdminCheck(publicKey);

  const visibleTabs = NAV_TABS.filter((tab) => !tab.adminOnly || isAdmin);

  const isTabActive = (tab: NavTab) => {
    if (tab.href === "/lending/borrow") {
      return pathname === "/lending" || pathname === "/lending/borrow" || pathname.startsWith("/lending/borrow/");
    }
    return pathname === tab.href || pathname.startsWith(`${tab.href}/`);
  };

  return (
    <div className="min-h-screen bg-midnight-950 pb-20 pt-24 text-white selection:bg-brand-500 selection:text-white">
      {/* Background Ambience */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.03] z-0 overflow-hidden">
        <div className="absolute inset-0 tribal-pattern scale-150 rotate-12" />
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Header Banner */}
        <div className="relative mb-8 overflow-hidden rounded-[2.5rem] bg-midnight-900 border border-white/5 shadow-2xl p-6 sm:p-10">
          <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-brand-500/10 blur-[100px]" />
          <div className="absolute -bottom-24 -left-24 h-64 w-64 rounded-full bg-mint-500/10 blur-[100px]" />
          <div className="absolute top-0 right-0 left-0 tribal-strip h-1.5 opacity-40" />

          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <div className="flex items-center gap-2.5 mb-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-500/10 border border-brand-500/20 px-3 py-1 text-xs font-semibold text-brand-400">
                  <Sparkles size={13} />
                  DeFi on Stellar
                </span>
              </div>
              <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-white">
                NFT Lending & Borrowing
              </h1>
              <p className="text-sm sm:text-base text-white/60 mt-1 max-w-2xl">
                Unlock instant liquidity against African art NFTs or earn interest by lending assets with decentralized collateral escrow.
              </p>
            </div>
          </div>

          {/* Secondary Top-Level Navigation Tabs */}
          <div className="mt-8 pt-6 border-t border-white/5">
            <nav
              aria-label="Lending navigation"
              className="flex items-center gap-2 overflow-x-auto pb-2 sm:pb-0 scrollbar-none"
            >
              {visibleTabs.map((tab) => {
                const active = isTabActive(tab);
                const Icon = tab.icon;

                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    className={clsx(
                      "group flex items-center gap-2.5 px-4 sm:px-5 py-2.5 rounded-2xl text-xs sm:text-sm font-semibold transition-all duration-200 whitespace-nowrap shrink-0",
                      active
                        ? "bg-gradient-to-r from-brand-500 to-terracotta-500 text-white shadow-lg shadow-brand-500/25 ring-1 ring-white/20"
                        : "bg-white/[0.03] text-white/70 hover:bg-white/[0.08] hover:text-white border border-white/5"
                    )}
                  >
                    <Icon
                      size={16}
                      className={clsx(
                        "transition-transform duration-200 group-hover:scale-110",
                        active ? "text-white" : "text-white/50 group-hover:text-white"
                      )}
                    />
                    <span>{tab.label}</span>
                    {tab.adminOnly && (
                      <span className="ml-1 rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] uppercase font-bold tracking-wider">
                        Admin
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>

        {/* Child Pages Container */}
        <main className="w-full">{children}</main>
      </div>
    </div>
  );
}
