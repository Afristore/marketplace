// ─────────────────────────────────────────────────────────────
// components/RoyaltiesDistributor.tsx — Distribute Royalties UI
// ─────────────────────────────────────────────────────────────

"use client";

import { useState, useEffect } from "react";
import {
  Send,
  Wallet,
  RefreshCw,
  AlertCircle,
  Loader,
} from "lucide-react";
import { clsx } from "clsx";
import { usePendingBalance, useDistributeRoyalties } from "@/hooks/useSplitter";
import { useToast } from "./ToastProvider";

interface RoyaltiesDistributorProps {
  userPublicKey: string | null;
}

export function RoyaltiesDistributor({
  userPublicKey,
}: RoyaltiesDistributorProps) {
  const [contractAddress, setContractAddress] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [isLoadingBalance, setIsLoadingBalance] = useState(false);
  const { pushToast } = useToast();

  const { balance, error: balanceError, refresh: refreshBalance } = usePendingBalance(
    contractAddress || null,
  );

  const { distribute, isDistributing, error: distributeError } =
    useDistributeRoyalties(userPublicKey);

  const handleLoadBalance = async () => {
    if (!contractAddress.trim()) {
      pushToast("Please enter a valid contract address", "error");
      return;
    }
    setIsLoadingBalance(true);
    await refreshBalance();
    setIsLoadingBalance(false);
  };

  const handleDistribute = async () => {
    if (!contractAddress.trim()) {
      pushToast("Contract address is required", "error");
      return;
    }

    if (balance === null || balance <= 0) {
      pushToast("No pending royalties to distribute", "error");
      return;
    }

    const success = await distribute(contractAddress);
    if (success) {
      pushToast("Royalties distributed successfully!", "success");
      setContractAddress("");
      setShowForm(false);
    } else {
      pushToast(
        distributeError || "Failed to distribute royalties",
        "error",
      );
    }
  };

  const formattedBalance = balance !== null ? (balance / 10_000_000).toFixed(7) : "0";
  const hasBalance = balance !== null && balance > 0;

  return (
    <div className="rounded-[2rem] bg-midnight-900 border border-white/5 shadow-xl p-8 sm:p-12">
      <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-terracotta-500/10 blur-[100px] pointer-events-none" />
      <div className="relative">
        <div className="flex items-center gap-3 mb-8">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-terracotta-500/10 border border-terracotta-500/20">
            <Send size={24} className="text-terracotta-400" />
          </div>
          <div>
            <h2 className="text-2xl sm:text-3xl font-display font-bold text-white">
              Distribute Royalties
            </h2>
            <p className="text-white/50 text-sm mt-1">
              Trigger fan-out of accumulated royalties to beneficiaries
            </p>
          </div>
        </div>

        {!showForm ? (
          <button
            onClick={() => setShowForm(true)}
            className="w-full px-6 py-3 rounded-xl bg-terracotta-500 hover:bg-terracotta-600 text-white font-semibold transition-colors duration-200 flex items-center justify-center gap-2"
          >
            <Wallet size={18} />
            Enter Splitter Contract Address
          </button>
        ) : (
          <div className="space-y-6">
            {/* Contract Address Input */}
            <div>
              <label className="block text-sm font-medium text-white/70 mb-3">
                Splitter Contract Address
              </label>
              <input
                type="text"
                value={contractAddress}
                onChange={(e) => {
                  setContractAddress(e.target.value);
                }}
                placeholder="Enter contract address (e.g., C...)"
                className="w-full px-4 py-3 rounded-lg bg-midnight-950 border border-white/10 text-white placeholder-white/30 focus:border-terracotta-500 focus:outline-none transition-colors"
              />
              <p className="text-xs text-white/40 mt-2">
                This is the address of your deployed Royalty Splitter contract.
              </p>
            </div>

            {/* Load Balance Button */}
            <button
              onClick={handleLoadBalance}
              disabled={isLoadingBalance || !contractAddress.trim()}
              className={clsx(
                "w-full px-6 py-3 rounded-lg font-semibold transition-colors duration-200 flex items-center justify-center gap-2",
                isLoadingBalance || !contractAddress.trim()
                  ? "bg-white/5 text-white/50 cursor-not-allowed"
                  : "bg-white/10 hover:bg-white/20 text-white",
              )}
            >
              {isLoadingBalance ? (
                <>
                  <Loader size={16} className="animate-spin" />
                  Loading Balance...
                </>
              ) : (
                <>
                  <RefreshCw size={16} />
                  Load Pending Balance
                </>
              )}
            </button>

            {/* Balance Display */}
            {balance !== null && (
              <div
                className={clsx(
                  "rounded-lg border p-4 transition-all duration-200",
                  hasBalance
                    ? "bg-terracotta-500/10 border-terracotta-500/30"
                    : "bg-amber-500/10 border-amber-500/30",
                )}
              >
                <div className="flex items-start gap-3">
                  <AlertCircle
                    size={18}
                    className={clsx(
                      "mt-0.5 shrink-0",
                      hasBalance ? "text-terracotta-400" : "text-amber-400",
                    )}
                  />
                  <div>
                    <p className="text-sm font-medium text-white">
                      Pending Balance
                    </p>
                    <p
                      className={clsx(
                        "text-2xl font-bold font-mono mt-1",
                        hasBalance ? "text-terracotta-400" : "text-amber-400",
                      )}
                    >
                      {formattedBalance} XLM
                    </p>
                    {!hasBalance && (
                      <p className="text-xs text-white/50 mt-2">
                        No royalties pending distribution
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Error Messages */}
            {balanceError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 flex items-start gap-3">
                <AlertCircle size={18} className="text-red-400 mt-0.5 shrink-0" />
                <p className="text-sm text-red-400">{balanceError}</p>
              </div>
            )}

            {distributeError && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4 flex items-start gap-3">
                <AlertCircle size={18} className="text-red-400 mt-0.5 shrink-0" />
                <p className="text-sm text-red-400">{distributeError}</p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4">
              <button
                onClick={handleDistribute}
                disabled={isDistributing || !hasBalance}
                className={clsx(
                  "flex-1 px-6 py-3 rounded-lg font-semibold transition-colors duration-200 flex items-center justify-center gap-2",
                  isDistributing || !hasBalance
                    ? "bg-white/5 text-white/50 cursor-not-allowed"
                    : "bg-terracotta-500 hover:bg-terracotta-600 text-white",
                )}
              >
                {isDistributing ? (
                  <>
                    <Loader size={16} className="animate-spin" />
                    Distributing...
                  </>
                ) : (
                  <>
                    <Send size={16} />
                    Distribute Funds
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  setShowForm(false);
                  setContractAddress("");
                }}
                disabled={isDistributing}
                className="px-6 py-3 rounded-lg bg-white/5 hover:bg-white/10 text-white font-semibold transition-colors duration-200 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
