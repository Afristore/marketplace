"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useWalletContext } from "@/context/WalletContext";
import { WalletGuard } from "@/components/WalletGuard";
import {
  getStakingPoolByNft,
  deployStakingPool,
} from "@/lib/launchpad";
import {
  getStakingPoolConfig,
  formatRewardRatePerDay,
  formatAnnualYieldPerNft,
} from "@/lib/staking";
import { assertSupportedTokenAddress } from "@/lib/token-support";
import {
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Lock,
  Search,
  Sparkles,
} from "lucide-react";

function isValidContractAddress(addr: string): boolean {
  const t = addr.trim();
  return t.startsWith("C") && t.length >= 56;
}

export default function StakingSetupPage() {
  const { publicKey } = useWalletContext();

  const [nftAddress, setNftAddress] = useState("");
  const [lookupAddress, setLookupAddress] = useState("");
  const [existingPool, setExistingPool] = useState<string | null>(null);
  const [poolConfig, setPoolConfig] = useState<{
    rewardToken: string;
    rewardRate: bigint;
  } | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [rewardToken, setRewardToken] = useState("");
  const [rewardRate, setRewardRate] = useState("");
  const [isDeploying, setIsDeploying] = useState(false);
  const [deployedPool, setDeployedPool] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkPool = useCallback(async (address: string) => {
    if (!isValidContractAddress(address)) {
      setError("Enter a valid Stellar contract address (starts with C).");
      return;
    }
    setError(null);
    setIsChecking(true);
    setExistingPool(null);
    setPoolConfig(null);
    setDeployedPool(null);
    try {
      const pool = await getStakingPoolByNft(address);
      setLookupAddress(address);
      if (pool) {
        setExistingPool(pool);
        const config = await getStakingPoolConfig(pool);
        setPoolConfig({
          rewardToken: config.rewardToken,
          rewardRate: config.rewardRate,
        });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to check pool");
    } finally {
      setIsChecking(false);
    }
  }, []);

  const handleDeploy = async () => {
    if (!publicKey || !lookupAddress) return;
    setError(null);
    setIsDeploying(true);
    try {
      const token = await assertSupportedTokenAddress(
        rewardToken,
        "reward",
      );
      const rateNum = parseFloat(rewardRate);
      if (isNaN(rateNum) || rateNum <= 0) {
        throw new Error("Reward rate must be a positive number (tokens per second).");
      }
      const rateStroops = BigInt(Math.round(rateNum * 10_000_000));
      const salt = Buffer.alloc(32);
      window.crypto.getRandomValues(salt);

      const poolAddress = await deployStakingPool(
        publicKey,
        lookupAddress,
        token.address, // reward token
        rateStroops,
        salt,
      );
      setDeployedPool(poolAddress);
      setExistingPool(poolAddress);
      setPoolConfig({
        rewardToken: token.address,
        rewardRate: rateStroops,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Deployment failed");
    } finally {
      setIsDeploying(false);
    }
  };

  const showForm = lookupAddress && !existingPool && !deployedPool;

  return (
    <main className="min-h-screen bg-midnight-950 text-white selection:bg-brand-500 selection:text-white">
      <div className="pt-24 pb-20">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <Link
            href="/staking"
            className="inline-flex items-center gap-2 text-sm text-white/60 hover:text-white transition-colors mb-8"
          >
            <ArrowLeft size={16} />
            Back to Staking Dashboard
          </Link>

          <div className="mb-10">
            <span className="inline-block px-4 py-1.5 rounded-full bg-brand-500/20 text-brand-400 text-xs font-bold uppercase tracking-widest mb-4">
              Creator Tools
            </span>
            <h1 className="text-4xl font-display font-black text-white mb-3">
              Staking Pool Setup
            </h1>
            <p className="text-white/60 font-inter leading-relaxed max-w-xl">
              Deploy a dedicated staking pool for your NFT collection. Each
              collection gets its own clone with custom reward token and emission
              rate.
            </p>
          </div>

          <WalletGuard actionName="To deploy a staking pool">
            {/* Step 1: NFT address lookup */}
            <div className="glass-card rounded-3xl p-8 mb-6">
              <h2 className="text-lg font-display font-bold text-white mb-1">
                NFT Collection Address
              </h2>
              <p className="text-sm text-white/60 mb-6">
                Paste your deployed NFT contract address to check if a staking
                pool already exists.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  value={nftAddress}
                  onChange={(e) => setNftAddress(e.target.value)}
                  placeholder="C..."
                  className="flex-1 rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm font-mono text-white placeholder:text-white/30 focus:outline-none focus:border-brand-500/50 focus:ring-1 focus:ring-brand-500/30"
                />
                <button
                  onClick={() => checkPool(nftAddress.trim())}
                  disabled={isChecking || !nftAddress.trim()}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-6 py-3 text-sm font-bold text-white hover:bg-brand-600 disabled:opacity-50 transition-all"
                >
                  {isChecking ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Search size={16} />
                  )}
                  Check Pool
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-center gap-3 rounded-xl bg-red-500/10 border border-red-500/20 p-4 mb-6">
                <AlertCircle size={20} className="text-red-400 shrink-0" />
                <p className="text-sm text-red-300">{error}</p>
              </div>
            )}

            {/* Existing pool found */}
            {existingPool && poolConfig && (
              <div className="glass-card rounded-3xl p-8 mb-6 border border-mint-500/20">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-mint-500/20 text-mint-400 shrink-0">
                    <CheckCircle2 size={24} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-lg font-display font-bold text-white">
                      Staking Pool Active
                    </h3>
                    <p className="text-sm text-white/60 mt-1">
                      A pool already exists for this collection.
                    </p>
                    <dl className="mt-6 space-y-3 text-sm">
                      <div>
                        <dt className="text-white/40 uppercase tracking-wider text-xs font-bold">
                          Pool Contract
                        </dt>
                        <dd className="font-mono text-white/80 mt-1 break-all">
                          {existingPool}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-white/40 uppercase tracking-wider text-xs font-bold">
                          Reward Token
                        </dt>
                        <dd className="font-mono text-white/80 mt-1 break-all">
                          {poolConfig.rewardToken}
                        </dd>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <dt className="text-white/40 uppercase tracking-wider text-xs font-bold">
                            Daily Rate / NFT
                          </dt>
                          <dd className="text-white mt-1 font-medium">
                            {formatRewardRatePerDay(poolConfig.rewardRate)} tokens
                          </dd>
                        </div>
                        <div>
                          <dt className="text-white/40 uppercase tracking-wider text-xs font-bold">
                            Annual Yield / NFT
                          </dt>
                          <dd className="text-white mt-1 font-medium">
                            {formatAnnualYieldPerNft(poolConfig.rewardRate)} tokens
                          </dd>
                        </div>
                      </div>
                    </dl>
                    <Link
                      href={`/staking?collection=${encodeURIComponent(lookupAddress)}`}
                      className="inline-flex items-center gap-2 mt-6 rounded-xl bg-white/10 border border-white/10 px-5 py-2.5 text-sm font-bold text-white hover:bg-white/15 transition-all"
                    >
                      <Lock size={14} />
                      Open Staking Dashboard
                    </Link>
                  </div>
                </div>
              </div>
            )}

            {/* Deploy form */}
            {showForm && (
              <div className="glass-card rounded-3xl p-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/20 text-brand-400">
                    <Sparkles size={20} />
                  </div>
                  <div>
                    <h3 className="text-lg font-display font-bold text-white">
                      Deploy New Pool
                    </h3>
                    <p className="text-sm text-white/60">
                      No pool found for{" "}
                      <span className="font-mono text-white/80">
                        {lookupAddress.slice(0, 12)}...
                      </span>
                    </p>
                  </div>
                </div>

                <div className="space-y-5">
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-white/40 mb-2">
                      Reward Token Address
                    </label>
                    <input
                      type="text"
                      value={rewardToken}
                      onChange={(e) => setRewardToken(e.target.value)}
                      placeholder="SAC contract address (C...)"
                      className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm font-mono text-white placeholder:text-white/30 focus:outline-none focus:border-brand-500/50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold uppercase tracking-wider text-white/40 mb-2">
                      Reward Rate (tokens per second)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="0.0000001"
                      value={rewardRate}
                      onChange={(e) => setRewardRate(e.target.value)}
                      placeholder="e.g. 0.1"
                      className="w-full rounded-xl bg-white/5 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-brand-500/50"
                    />
                    <p className="text-xs text-white/40 mt-2">
                      Each staked NFT earns this many reward tokens per second.
                    </p>
                  </div>
                  <button
                    onClick={handleDeploy}
                    disabled={isDeploying || !rewardToken || !rewardRate}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-6 py-3.5 text-sm font-bold text-white hover:bg-brand-600 disabled:opacity-50 transition-all"
                  >
                    {isDeploying ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        Deploying Pool...
                      </>
                    ) : (
                      <>
                        <Sparkles size={16} />
                        Deploy Staking Pool
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {deployedPool && (
              <div className="glass-card-warm rounded-3xl p-8 mt-6 border border-brand-500/20">
                <h3 className="text-lg font-display font-bold text-white mb-2">
                  Pool Deployed Successfully
                </h3>
                <p className="font-mono text-sm text-white/80 break-all">
                  {deployedPool}
                </p>
                <Link
                  href={`/staking?collection=${encodeURIComponent(lookupAddress)}`}
                  className="inline-flex items-center gap-2 mt-4 rounded-xl bg-brand-500 px-5 py-2.5 text-sm font-bold text-white hover:bg-brand-600 transition-all"
                >
                  Go to Staking Dashboard
                </Link>
              </div>
            )}
          </WalletGuard>
        </div>
      </div>
    </main>
  );
}
