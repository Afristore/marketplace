"use client";

import Link from "next/link";
import { Coins, Sparkles, ArrowRight, Landmark } from "lucide-react";

export default function BorrowPage() {
  return (
    <div className="space-y-8">
      <div className="rounded-3xl bg-midnight-900/60 border border-white/5 p-6 sm:p-8 backdrop-blur-xl">
        <h2 className="text-xl sm:text-2xl font-bold font-display text-white">
          Borrow Liquidity Against NFTs
        </h2>
        <p className="text-sm text-white/60 mt-1 max-w-2xl">
          Browse open listings created by lenders. Deposit collateral in whitelisted Stellar tokens (e.g. USDC, XLM) to borrow African art NFTs for exhibitions, staking yield, or commercial display.
        </p>
      </div>

      <div className="rounded-3xl bg-midnight-900/40 border border-white/5 p-12 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-400 mb-4 ring-1 ring-brand-500/20">
          <Coins size={32} />
        </div>
        <h3 className="text-lg font-bold text-white mb-2">Explore Available Lending Listings</h3>
        <p className="text-sm text-white/50 max-w-md mx-auto mb-6">
          Ready to lend your own NFTs instead? List them with customized interest rates and durations.
        </p>
        <Link
          href="/lending/lend"
          className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-terracotta-500 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-brand-500/25 hover:opacity-95 transition-all"
        >
          <Landmark size={16} />
          <span>Switch to Lender Flow</span>
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  );
}
