"use client";

import { useWalletContext } from "@/context/WalletContext";
import { useAdminCheck } from "@/hooks/useAdmin";
import { ShieldCheck, Lock, Settings } from "lucide-react";

export default function LendingAdminPage() {
  const { publicKey } = useWalletContext();
  const { isAdmin, isLoading } = useAdminCheck(publicKey);

  if (isLoading) {
    return (
      <div className="rounded-3xl bg-midnight-900/40 border border-white/5 p-12 text-center text-white/50">
        Checking admin authorizations...
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="rounded-3xl bg-midnight-900/40 border border-white/5 p-12 text-center">
        <Lock size={36} className="mx-auto text-terracotta-400 mb-3" />
        <h3 className="text-lg font-bold text-white mb-2">Admin Access Required</h3>
        <p className="text-sm text-white/50 max-w-md mx-auto">
          This panel is restricted to the lending protocol administrator.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="rounded-3xl bg-midnight-900/60 border border-white/5 p-6 sm:p-8 backdrop-blur-xl">
        <h2 className="text-xl sm:text-2xl font-bold font-display text-white">
          Lending Protocol Administration
        </h2>
        <p className="text-sm text-white/60 mt-1 max-w-2xl">
          Configure protocol fee rates, liquidator rewards, minimum collateral buffers, and currency whitelists.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-3xl bg-midnight-900/60 border border-white/5 p-6 backdrop-blur-xl space-y-4">
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <Settings size={18} className="text-brand-400" />
            Protocol Parameters
          </h3>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between border-b border-white/5 pb-2">
              <span className="text-white/60">Platform Fee:</span>
              <span className="font-mono text-white">1.0% (100 bps)</span>
            </div>
            <div className="flex justify-between border-b border-white/5 pb-2">
              <span className="text-white/60">Liquidator Reward:</span>
              <span className="font-mono text-white">5.0% (500 bps)</span>
            </div>
            <div className="flex justify-between border-b border-white/5 pb-2">
              <span className="text-white/60">Default Collateral Buffer:</span>
              <span className="font-mono text-white">120% (12000 bps)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
