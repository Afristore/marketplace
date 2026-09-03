"use client";

import { useWalletContext } from "@/context/WalletContext";
import { LayoutDashboard, Wallet, Layers, ShieldCheck } from "lucide-react";

export default function LendingDashboardPage() {
  const { isConnected, connect, publicKey } = useWalletContext();

  return (
    <div className="space-y-8">
      <div className="rounded-3xl bg-midnight-900/60 border border-white/5 p-6 sm:p-8 backdrop-blur-xl">
        <h2 className="text-xl sm:text-2xl font-bold font-display text-white">
          Lending & Borrowing Dashboard
        </h2>
        <p className="text-sm text-white/60 mt-1 max-w-2xl">
          Track active loans, positions, health factors, accrued interest, and collateral status in one place.
        </p>
      </div>

      {!isConnected ? (
        <div className="rounded-3xl bg-midnight-900/40 border border-white/5 p-12 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-400 mb-4">
            <Wallet size={32} />
          </div>
          <h3 className="text-lg font-bold text-white mb-2">Connect Your Wallet</h3>
          <p className="text-sm text-white/50 max-w-md mx-auto mb-6">
            Connect your wallet to inspect your active lending listings and open borrower positions.
          </p>
          <button
            onClick={() => connect()}
            className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-terracotta-500 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-brand-500/25 hover:opacity-95 transition-all"
          >
            <Wallet size={16} />
            Connect Wallet
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="rounded-3xl bg-midnight-900/60 border border-white/5 p-6 backdrop-blur-xl">
            <span className="text-xs font-bold uppercase tracking-wider text-white/40">Active Listings</span>
            <p className="text-3xl font-display font-bold text-white mt-2">0</p>
            <p className="text-xs text-white/40 mt-1">NFTs currently available to borrow</p>
          </div>
          <div className="rounded-3xl bg-midnight-900/60 border border-white/5 p-6 backdrop-blur-xl">
            <span className="text-xs font-bold uppercase tracking-wider text-white/40">Active Borrow Positions</span>
            <p className="text-3xl font-display font-bold text-white mt-2">0</p>
            <p className="text-xs text-white/40 mt-1">Loans with escrowed collateral</p>
          </div>
          <div className="rounded-3xl bg-midnight-900/60 border border-white/5 p-6 backdrop-blur-xl">
            <span className="text-xs font-bold uppercase tracking-wider text-white/40">Total Interest Earned</span>
            <p className="text-3xl font-display font-bold text-mint-400 mt-2">$0.00</p>
            <p className="text-xs text-white/40 mt-1">Settled lending yields</p>
          </div>
        </div>
      )}
    </div>
  );
}
