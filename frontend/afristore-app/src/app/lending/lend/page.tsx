// ─────────────────────────────────────────────────────────────
// app/lending/lend/page.tsx — Lender Flow (List NFT for Lending)
// ─────────────────────────────────────────────────────────────
"use client";

import { useState } from "react";
import Link from "next/link";
import { useWalletContext } from "@/context/WalletContext";
import { useOwnedNFTs } from "@/hooks/useOwnedNFTs";
import { OwnedToken } from "@/lib/indexer";
import {
  Wallet,
  Sparkles,
  Layers,
  ArrowRight,
  Info,
  CheckCircle2,
  AlertCircle,
  Clock,
  Percent,
  Shield,
  Loader2,
  PackageOpen,
  Image as ImageIcon,
  Compass,
} from "lucide-react";
import clsx from "clsx";

export default function LendPage() {
  const { publicKey, isConnected, isConnecting, connect } = useWalletContext();
  const { tokens, isLoading, error, refresh } = useOwnedNFTs(publicKey);

  const [selectedNft, setSelectedNft] = useState<OwnedToken | null>(null);
  const [loanAmount, setLoanAmount] = useState<string>("100");
  const [durationDays, setDurationDays] = useState<number>(30);
  const [interestRateBps, setInterestRateBps] = useState<number>(1000); // 10%
  const [collateralBufferBps, setCollateralBufferBps] = useState<number>(12000); // 120%
  const [liquidationThresholdBps, setLiquidationThresholdBps] = useState<number>(11000); // 110%
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitSuccess, setSubmitSuccess] = useState<boolean>(false);

  const handleSelectNft = (token: OwnedToken) => {
    setSelectedNft(token);
    setSubmitSuccess(false);
  };

  const parsedAmount = parseFloat(loanAmount) || 0;
  const estimatedInterestUsd = (parsedAmount * (interestRateBps / 10000)).toFixed(2);
  const requiredCollateralUsd = (parsedAmount * (collateralBufferBps / 10000)).toFixed(2);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedNft || parsedAmount <= 0) return;

    setIsSubmitting(true);
    try {
      // Simulation of listing transaction for frontend flow
      await new Promise((resolve) => setTimeout(resolve, 50));
      setSubmitSuccess(true);
    } catch (err) {
      console.error("Listing creation failed:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* Overview Card */}
      <div className="rounded-3xl bg-midnight-900/60 border border-white/5 p-6 sm:p-8 backdrop-blur-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold font-display text-white">
              List Artworks for Lending
            </h2>
            <p className="text-sm text-white/60 mt-1 max-w-2xl">
              Select an NFT from your wallet to escrow as collateral for a loan. Borrowers can draw liquidity while providing collateral tokens with automated interest settlement.
            </p>
          </div>
          {isConnected && (
            <button
              onClick={() => refresh()}
              disabled={isLoading}
              className="inline-flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-4 py-2 text-xs font-semibold text-white/80 hover:bg-white/10 hover:text-white transition-all self-start sm:self-auto"
            >
              <Layers size={14} className={isLoading ? "animate-spin" : ""} />
              Refresh NFTs
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      {!isConnected ? (
        <div className="rounded-3xl bg-midnight-900/40 border border-white/5 p-12 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-500/10 text-brand-400 mb-4 ring-1 ring-brand-500/20">
            <Wallet size={32} />
          </div>
          <h3 className="text-lg font-bold text-white mb-2">Connect Your Stellar Wallet</h3>
          <p className="text-sm text-white/50 max-w-md mx-auto mb-6">
            Connect your Freighter or Stellar-compatible wallet to view your owned African art NFTs and create lending listings.
          </p>
          <button
            onClick={() => connect()}
            disabled={isConnecting}
            className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-terracotta-500 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-brand-500/25 hover:from-brand-600 hover:to-terracotta-600 transition-all"
          >
            {isConnecting ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                <Wallet size={16} />
                Connect Wallet
              </>
            )}
          </button>
        </div>
      ) : isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="rounded-3xl bg-midnight-900/40 border border-white/5 p-4 animate-pulse space-y-4"
            >
              <div className="aspect-square rounded-2xl bg-white/5 w-full" />
              <div className="h-4 bg-white/5 rounded-full w-2/3" />
              <div className="h-3 bg-white/5 rounded-full w-1/3" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="rounded-3xl bg-red-500/10 border border-red-500/20 p-8 text-center">
          <AlertCircle size={36} className="mx-auto text-red-400 mb-3" />
          <h3 className="text-base font-bold text-white mb-1">Failed to load NFTs</h3>
          <p className="text-sm text-red-300/80 mb-4">{error}</p>
          <button
            onClick={() => refresh()}
            className="inline-flex items-center gap-2 rounded-xl bg-red-500/20 border border-red-500/30 px-4 py-2 text-xs font-bold text-red-200 hover:bg-red-500/30 transition-all"
          >
            Try Again
          </button>
        </div>
      ) : tokens.length === 0 ? (
        /* Empty State */
        <div
          data-testid="lending-nfts-empty"
          className="rounded-3xl bg-midnight-900/40 border border-white/5 p-12 text-center"
        >
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5 text-white/40 mb-4">
            <PackageOpen size={32} />
          </div>
          <h3 className="text-lg font-bold text-white mb-2">No NFTs Found in Connected Wallet</h3>
          <p className="text-sm text-white/50 max-w-md mx-auto mb-6">
            You do not hold any valid NFTs in this wallet to list as loan collateral. Explore our marketplace or mint a piece from our launchpad.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/explore"
              className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-terracotta-500 px-5 py-2.5 text-xs sm:text-sm font-bold text-white shadow-lg shadow-brand-500/25 hover:opacity-90 transition-all"
            >
              <Compass size={16} />
              Explore Marketplace
            </Link>
            <Link
              href="/launchpad"
              className="inline-flex items-center gap-2 rounded-2xl bg-white/5 border border-white/10 px-5 py-2.5 text-xs sm:text-sm font-bold text-white/80 hover:bg-white/10 hover:text-white transition-all"
            >
              <Sparkles size={16} />
              Launchpad Drops
            </Link>
          </div>
        </div>
      ) : (
        /* NFT Grid & Configuration Split View */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left: NFT Selector Grid */}
          <div className="lg:col-span-7 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-white/50">
                Your NFTs ({tokens.length})
              </span>
              <span className="text-xs text-brand-400 font-medium">
                Click an NFT to configure loan terms
              </span>
            </div>

            <div
              data-testid="lending-nfts-grid"
              className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[600px] overflow-y-auto pr-1 scrollbar-thin"
            >
              {tokens.map((token) => {
                const isSelected =
                  selectedNft?.collectionAddress === token.collectionAddress &&
                  selectedNft?.tokenId === token.tokenId;

                return (
                  <div
                    key={`${token.collectionAddress}-${token.tokenId}`}
                    onClick={() => handleSelectNft(token)}
                    className={clsx(
                      "group cursor-pointer rounded-2xl bg-midnight-900 border p-4 transition-all duration-200 text-left relative overflow-hidden",
                      isSelected
                        ? "border-brand-500 bg-brand-500/10 ring-2 ring-brand-500/30 shadow-lg shadow-brand-500/10"
                        : "border-white/5 hover:border-white/20 hover:bg-midnight-850"
                    )}
                  >
                    {/* Image / Thumbnail */}
                    <div className="aspect-square w-full rounded-xl bg-midnight-950/80 border border-white/5 overflow-hidden flex items-center justify-center relative mb-3">
                      {token.image ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={token.image}
                          alt={token.name || `NFT #${token.tokenId}`}
                          className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      ) : (
                        <div className="flex flex-col items-center justify-center text-white/20">
                          <ImageIcon size={36} />
                          <span className="text-[10px] mt-1">Artwork #{token.tokenId}</span>
                        </div>
                      )}

                      {isSelected && (
                        <div className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-brand-500 text-white shadow-md">
                          <CheckCircle2 size={16} />
                        </div>
                      )}
                    </div>

                    {/* Meta */}
                    <h4 className="font-bold text-sm text-white truncate">
                      {token.name || `Token #${token.tokenId}`}
                    </h4>
                    <p className="text-[11px] font-mono text-white/40 truncate mt-0.5">
                      {token.collectionAddress.slice(0, 8)}...{token.collectionAddress.slice(-6)}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right: Loan Terms Configuration Form */}
          <div className="lg:col-span-5">
            <div className="sticky top-28 rounded-3xl bg-midnight-900 border border-white/5 p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
              <h3 className="text-lg font-bold font-display text-white mb-1">
                Lending Terms Configuration
              </h3>
              <p className="text-xs text-white/50 mb-6">
                Set loan amount, duration, interest rate, and required collateral parameters.
              </p>

              {!selectedNft ? (
                <div className="rounded-2xl bg-white/[0.02] border border-dashed border-white/10 p-8 text-center text-white/40">
                  <Layers size={28} className="mx-auto mb-2 opacity-50" />
                  <p className="text-xs">Select an NFT from the list to begin creating a loan listing</p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  {/* Selected NFT summary */}
                  <div className="flex items-center gap-3 rounded-2xl bg-white/[0.03] border border-white/10 p-3">
                    <div className="h-12 w-12 rounded-xl bg-midnight-950 border border-white/10 overflow-hidden flex items-center justify-center shrink-0">
                      {selectedNft.image ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img src={selectedNft.image} alt="NFT" className="h-full w-full object-cover" />
                      ) : (
                        <ImageIcon size={20} className="text-white/30" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-white truncate">
                        {selectedNft.name || `Token #${selectedNft.tokenId}`}
                      </p>
                      <p className="text-[10px] font-mono text-white/40 truncate">
                        ID: #{selectedNft.tokenId}
                      </p>
                    </div>
                  </div>

                  {/* Loan Amount */}
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-white/60 mb-1.5">
                      Declared Price / Loan Amount (USD)
                    </label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-white/40 font-bold">
                        $
                      </span>
                      <input
                        type="number"
                        min="1"
                        step="any"
                        value={loanAmount}
                        onChange={(e) => setLoanAmount(e.target.value)}
                        placeholder="100.00"
                        required
                        className="w-full rounded-xl bg-midnight-950 border border-white/10 pl-8 pr-4 py-2.5 text-sm text-white placeholder-white/20 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    </div>
                  </div>

                  {/* Duration Presets */}
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-white/60 mb-1.5">
                      Max Duration (Days)
                    </label>
                    <div className="grid grid-cols-4 gap-2">
                      {[7, 14, 30, 60].map((days) => (
                        <button
                          key={days}
                          type="button"
                          onClick={() => setDurationDays(days)}
                          className={clsx(
                            "rounded-xl py-2 text-xs font-bold transition-all",
                            durationDays === days
                              ? "bg-brand-500 text-white shadow-md"
                              : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
                          )}
                        >
                          {days}d
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Interest Rate (BPS) */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-bold uppercase tracking-wider text-white/60">
                        Interest Rate
                      </label>
                      <span className="text-xs font-mono font-bold text-brand-400">
                        {(interestRateBps / 100).toFixed(1)}% APY
                      </span>
                    </div>
                    <input
                      type="range"
                      min="100"
                      max="3000"
                      step="50"
                      value={interestRateBps}
                      onChange={(e) => setInterestRateBps(parseInt(e.target.value, 10))}
                      className="w-full accent-brand-500"
                    />
                  </div>

                  {/* Collateral Buffer & Liquidation threshold info */}
                  <div className="rounded-2xl bg-white/[0.02] border border-white/5 p-4 space-y-2 text-xs">
                    <div className="flex items-center justify-between text-white/60">
                      <span>Est. Term Interest:</span>
                      <span className="font-mono text-white font-medium">+${estimatedInterestUsd} USD</span>
                    </div>
                    <div className="flex items-center justify-between text-white/60">
                      <span>Min. Borrower Collateral (120%):</span>
                      <span className="font-mono text-mint-400 font-medium">${requiredCollateralUsd} USD</span>
                    </div>
                    <div className="flex items-center justify-between text-white/60">
                      <span>Liquidation Threshold:</span>
                      <span className="font-mono text-terracotta-400 font-medium">110%</span>
                    </div>
                  </div>

                  {submitSuccess && (
                    <div className="flex items-center gap-2 rounded-xl bg-mint-500/10 border border-mint-500/20 p-3 text-xs text-mint-300">
                      <CheckCircle2 size={16} className="text-mint-400 shrink-0" />
                      <span>NFT successfully listed for lending!</span>
                    </div>
                  )}

                  {/* Submit Button */}
                  <button
                    type="submit"
                    disabled={isSubmitting || parsedAmount <= 0}
                    className="w-full flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-brand-500 to-terracotta-500 py-3 text-sm font-bold text-white shadow-lg shadow-brand-500/25 hover:opacity-95 disabled:opacity-50 transition-all"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Listing NFT...
                      </>
                    ) : (
                      <>
                        <span>Create Lending Listing</span>
                        <ArrowRight size={16} />
                      </>
                    )}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
