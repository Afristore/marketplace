"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useWalletContext } from "@/context/WalletContext";
import { useOwnedNFTs } from "@/hooks/useOwnedNFTs";
import { getStakingPoolByNft } from "@/lib/launchpad";
import {
  calculateRewards,
  estimateApyPercent,
  formatRewardRatePerDay,
  formatAnnualYieldPerNft,
  getStakingPoolConfig,
  type StakingPoolConfig,
} from "@/lib/staking";
import { config } from "@/lib/config";
import {
  AlertCircle,
  Lock,
  Unlock,
  Coins,
  Wallet,
  Layers,
  Search,
  Loader2,
  Settings,
  TrendingUp,
} from "lucide-react";

interface StakedItem {
  id: string;
  collectionAddress: string;
  tokenId: number;
  name?: string;
  image?: string;
  stakedAt: string;
  rewardsEarned: string;
}

function StakingPageContent() {
  const searchParams = useSearchParams();
  const { publicKey, isConnected, isConnecting } = useWalletContext();
  const { tokens: ownedNfts, isLoading: nftsLoading, refresh: refreshNFTs } =
    useOwnedNFTs(publicKey);

  const [collectionInput, setCollectionInput] = useState("");
  const [activeCollection, setActiveCollection] = useState("");
  const [poolAddress, setPoolAddress] = useState<string | null>(null);
  const [poolConfig, setPoolConfig] = useState<StakingPoolConfig | null>(null);
  const [poolStakedCount, setPoolStakedCount] = useState(0);
  const [isLoadingPool, setIsLoadingPool] = useState(false);

  const [stakedNfts, setStakedNfts] = useState<StakedItem[]>([]);
  const [isLoadingStaked, setIsLoadingStaked] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isStaking, setIsStaking] = useState(false);
  const [isUnstaking, setIsUnstaking] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingRewards, setPendingRewards] = useState(0);
  const [activeTab, setActiveTab] = useState<"unstaked" | "staked">("unstaked");

  const loadPool = useCallback(async (nftAddress: string) => {
    const trimmed = nftAddress.trim();
    if (!trimmed.startsWith("C") || trimmed.length < 56) {
      setError("Enter a valid NFT contract address (starts with C).");
      return;
    }
    setError(null);
    setIsLoadingPool(true);
    setPoolAddress(null);
    setPoolConfig(null);
    try {
      const pool = await getStakingPoolByNft(trimmed);
      if (!pool) {
        setError(
          "No staking pool found for this collection. Creators can deploy one from the setup page.",
        );
        setActiveCollection(trimmed);
        return;
      }
      setActiveCollection(trimmed);
      setPoolAddress(pool);
      const [cfg, stakedTotal] = await Promise.all([
        getStakingPoolConfig(pool),
        import("@/lib/staking").then((m) => m.totalStaked(pool)),
      ]);
      setPoolConfig(cfg);
      setPoolStakedCount(stakedTotal);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load staking pool");
    } finally {
      setIsLoadingPool(false);
    }
  }, []);

  useEffect(() => {
    const fromQuery = searchParams.get("collection");
    if (fromQuery) {
      setCollectionInput(fromQuery);
      loadPool(fromQuery);
    }
  }, [searchParams, loadPool]);

  const fetchStakedNfts = useCallback(async () => {
    if (!publicKey || !activeCollection) return;
    setIsLoadingStaked(true);
    try {
      const res = await fetch(
        `${config.indexerUrl}/wallets/${encodeURIComponent(publicKey)}/staked`,
      );
      if (res.ok) {
        const data = await res.json();
        const mapped = (data || [])
          .filter(
            (item: { tokenAddress: string }) =>
              item.tokenAddress === activeCollection,
          )
          .map((item: {
            tokenAddress: string;
            tokenId: string;
            stakedAt: string;
            rewardsEarned?: string;
          }) => ({
            id: `${item.tokenAddress}-${item.tokenId}`,
            collectionAddress: item.tokenAddress,
            tokenId: Number(item.tokenId),
            name: `NFT #${item.tokenId}`,
            stakedAt: item.stakedAt,
            rewardsEarned: item.rewardsEarned || "0",
          }));
        setStakedNfts(mapped);
      }
    } catch {
      // Indexer may not have staking support yet — fall back to on-chain
      if (poolAddress) {
        try {
          const { getUserStakes } = await import("@/lib/staking");
          const positions = await getUserStakes(publicKey, poolAddress);
          const mapped = positions
            .filter((p) => p.token_address === activeCollection)
            .map((p) => ({
              id: `${p.token_address}-${p.token_id}`,
              collectionAddress: p.token_address,
              tokenId: p.token_id,
              name: `NFT #${p.token_id}`,
              stakedAt: String(p.staked_at),
              rewardsEarned: p.rewards_earned,
            }));
          setStakedNfts(mapped);
        } catch {
          /* ignore */
        }
      }
    } finally {
      setIsLoadingStaked(false);
    }
  }, [publicKey, activeCollection, poolAddress]);

  const fetchPendingRewards = useCallback(async () => {
    if (!publicKey || !poolAddress) {
      setPendingRewards(0);
      return;
    }
    try {
      const rewards = await calculateRewards(publicKey, poolAddress);
      setPendingRewards(rewards);
    } catch {
      setPendingRewards(0);
    }
  }, [publicKey, poolAddress]);

  useEffect(() => {
    if (publicKey && activeCollection && poolAddress) {
      fetchStakedNfts();
      fetchPendingRewards();
    }
  }, [publicKey, activeCollection, poolAddress, fetchStakedNfts, fetchPendingRewards]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleStakeSelected = async () => {
    if (!publicKey || !poolAddress || selectedIds.size === 0) return;
    setIsStaking(true);
    setError(null);
    try {
      const { stake } = await import("@/lib/staking");
      const selected = collectionNfts.filter(
        (nft) =>
          selectedIds.has(`${nft.collectionAddress}-${nft.tokenId}`) &&
          nft.collectionAddress &&
          typeof nft.tokenId === "number",
      );
      for (const nft of selected) {
        await stake(
          publicKey,
          nft.collectionAddress,
          nft.tokenId,
          poolAddress,
        );
      }
      setSelectedIds(new Set());
      await refreshNFTs();
      await fetchStakedNfts();
      await fetchPendingRewards();
      const { totalStaked } = await import("@/lib/staking");
      const updatedTotal = await totalStaked(poolAddress);
      setPoolStakedCount(updatedTotal);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Staking failed");
    } finally {
      setIsStaking(false);
    }
  };

  const handleUnstake = async (collectionAddress: string, tokenId: number) => {
    if (!publicKey || !poolAddress) return;
    setIsUnstaking(true);
    setError(null);
    try {
      const { unstake, totalStaked } = await import("@/lib/staking");
      await unstake(publicKey, collectionAddress, tokenId, poolAddress);
      await fetchStakedNfts();
      await refreshNFTs();
      await fetchPendingRewards();
      const updatedTotal = await totalStaked(poolAddress);
      setPoolStakedCount(updatedTotal);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unstaking failed");
    } finally {
      setIsUnstaking(false);
    }
  };

  const handleClaimRewards = async () => {
    if (!publicKey || !poolAddress) return;
    setIsClaiming(true);
    setError(null);
    try {
      const { claimRewards } = await import("@/lib/staking");
      await claimRewards(publicKey, poolAddress);
      await fetchStakedNfts();
      await fetchPendingRewards();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Claim failed");
    } finally {
      setIsClaiming(false);
    }
  };

  const collectionNfts = activeCollection
    ? ownedNfts.filter(
        (n) =>
          n.collectionAddress === activeCollection &&
          typeof n.tokenId === "number" &&
          n.tokenId >= 0,
      )
    : [];

  const unstakedNfts = collectionNfts.filter(
    (nft) =>
      !stakedNfts.some(
        (s) =>
          s.collectionAddress === nft.collectionAddress &&
          s.tokenId === nft.tokenId,
      ),
  );

  const apyDisplay = poolConfig
    ? estimateApyPercent(poolConfig.rewardRate, poolStakedCount || 1)
    : "—";

  if (!isConnected) {
    return (
      <main className="min-h-screen bg-midnight-950 text-white selection:bg-brand-500 selection:text-white">
        <div className="pt-32 pb-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6">
            <h1 className="text-5xl font-display font-bold text-white tracking-tight">
              NFT Staking
            </h1>
            <p className="mt-4 max-w-xl text-xl text-white/60 font-inter leading-relaxed">
              Stake NFTs from any collection to earn custom reward tokens
            </p>
          </div>
        </div>
        <div className="flex flex-col items-center justify-center py-20">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5 border border-white/10 text-brand-400 mb-4">
            <Wallet size={32} />
          </div>
          <h3 className="font-display font-bold text-white text-lg">
            Connect your wallet
          </h3>
          <p className="mt-1 text-sm text-white/60 max-w-sm text-center">
            {isConnecting
              ? "Connecting..."
              : "Connect your Freighter wallet to stake NFTs and earn rewards."}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-midnight-950 text-white selection:bg-brand-500 selection:text-white pb-20">
      {/* Header */}
      <div className="pt-32 pb-12">
        <div className="mx-auto max-w-7xl px-4 sm:px-6">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-8">
            <div className="space-y-4">
              <h1 className="text-5xl font-display font-bold text-white tracking-tight">
                NFT Staking
              </h1>
              <p className="max-w-xl text-xl text-white/60 font-inter leading-relaxed">
                Load a collection&apos;s staking pool to stake NFTs and earn
                rewards
              </p>
            </div>
            <Link
              href="/staking/setup"
              className="inline-flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-5 py-2.5 text-sm font-bold text-white/80 hover:bg-white/10 hover:text-white transition-all"
            >
              <Settings size={16} />
              Creator Setup
            </Link>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 space-y-6">
        {/* Collection lookup */}
        <div className="glass-card rounded-3xl p-6 border border-white/5">
          <h2 className="text-sm font-bold uppercase tracking-widest text-white/40 mb-4">
            NFT Collection Address
          </h2>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={collectionInput}
              onChange={(e) => setCollectionInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") loadPool(collectionInput);
              }}
              placeholder="Paste NFT contract address (C...)"
              className="flex-1 rounded-xl bg-white/5 border border-white/5 px-4 py-3 text-sm font-mono text-white placeholder:text-white/30 focus:outline-none focus:border-brand-500/50"
            />
            <button
              onClick={() => loadPool(collectionInput)}
              disabled={isLoadingPool || !collectionInput.trim()}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand-500 px-6 py-3 text-sm font-bold text-white hover:bg-brand-600 disabled:opacity-50 transition-all"
            >
              {isLoadingPool ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Search size={16} />
              )}
              Load Pool
            </button>
          </div>
        </div>

        {/* Pool stats */}
        {poolConfig && poolAddress && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="glass-card rounded-2xl p-5 border border-white/5">
              <p className="text-xs font-bold uppercase tracking-widest text-white/40">
                Reward Token
              </p>
              <p className="font-mono text-sm text-white/80 mt-2 truncate">
                {poolConfig.rewardToken}
              </p>
            </div>
            <div className="glass-card rounded-2xl p-5 border border-white/5">
              <p className="text-xs font-bold uppercase tracking-widest text-white/40">
                Daily Rate / NFT
              </p>
              <p className="text-2xl font-display font-bold text-white mt-2">
                {formatRewardRatePerDay(poolConfig.rewardRate)}
              </p>
            </div>
            <div className="glass-card rounded-2xl p-5 border border-white/5">
              <div className="flex items-center gap-1.5">
                <TrendingUp size={14} className="text-mint-400" />
                <p className="text-xs font-bold uppercase tracking-widest text-white/40">
                  Est. APY
                </p>
              </div>
              <p className="text-2xl font-display font-bold text-mint-400 mt-2" data-testid="staking-apy">
                {apyDisplay}
                {apyDisplay !== "—" && apyDisplay !== "0" && (
                  <span className="text-sm font-normal text-white/40 ml-1">
                    tokens/NFT/yr
                  </span>
                )}
              </p>
            </div>
            <div className="glass-card rounded-2xl p-5 border border-white/5">
              <p className="text-xs font-bold uppercase tracking-widest text-white/40">
                Pool TVL
              </p>
              <p className="text-2xl font-display font-bold text-white mt-2" data-testid="staking-tvl">
                {poolStakedCount}{" "}
                <span className="text-sm font-normal text-white/40">staked</span>
              </p>
              <p className="text-xs text-white/40 mt-1 truncate font-mono">
                {poolAddress.slice(0, 16)}...
              </p>
            </div>
          </div>
        )}

        {!poolAddress && activeCollection && !isLoadingPool && (
          <div className="glass-card rounded-2xl p-6 border border-white/5 text-center">
            <p className="text-white/60 text-sm">
              No staking pool deployed for this collection.{" "}
              <Link
                href="/staking/setup"
                className="text-brand-400 hover:text-brand-300 font-medium"
              >
                Deploy one as a creator
              </Link>
            </p>
          </div>
        )}

        {poolAddress && (
          <>
            {/* Stats row */}
            <div className="flex flex-wrap gap-8">
              <div>
                <span className="text-3xl font-display font-bold text-white block">
                  {stakedNfts.length}
                </span>
                <span className="text-sm font-bold uppercase tracking-widest text-brand-400">
                  Your Staked
                </span>
              </div>
              <div>
                <span className="text-3xl font-display font-bold text-white block">
                  {collectionNfts.length}
                </span>
                <span className="text-sm font-bold uppercase tracking-widest text-brand-400">
                  You Own
                </span>
              </div>
              <div>
                <span className="text-3xl font-display font-bold text-white block">
                  {formatAnnualYieldPerNft(poolConfig!.rewardRate)}
                </span>
                <span className="text-sm font-bold uppercase tracking-widest text-brand-400">
                  Annual / NFT
                </span>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-4 border-b border-white/5">
              <button
                onClick={() => setActiveTab("unstaked")}
                className={`pb-3 px-1 text-sm font-bold uppercase tracking-wider transition-colors ${
                  activeTab === "unstaked"
                    ? "text-brand-400 border-b-2 border-brand-500"
                    : "text-white/40 hover:text-white/60"
                }`}
              >
                Unstaked NFTs
              </button>
              <button
                onClick={() => setActiveTab("staked")}
                className={`pb-3 px-1 text-sm font-bold uppercase tracking-wider transition-colors ${
                  activeTab === "staked"
                    ? "text-brand-400 border-b-2 border-brand-500"
                    : "text-white/40 hover:text-white/60"
                }`}
              >
                Staked Vault
              </button>
            </div>
          </>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-3 rounded-xl bg-red-500/10 border border-red-500/20 p-4">
            <AlertCircle size={20} className="text-red-400 shrink-0" />
            <p className="text-sm text-red-300">{error}</p>
            <button
              onClick={() => setError(null)}
              className="ml-auto text-red-400/60 hover:text-red-300 text-sm font-medium"
            >
              Dismiss
            </button>
          </div>
        )}

        {poolAddress && activeTab === "unstaked" && selectedIds.size > 0 && (
          <div className="flex items-center justify-between rounded-xl bg-brand-500/10 border border-brand-500/20 p-4">
            <span className="text-sm font-medium text-white/80">
              {selectedIds.size} NFT{selectedIds.size > 1 ? "s" : ""} selected
            </span>
            <button
              onClick={handleStakeSelected}
              disabled={isStaking}
              className="flex items-center gap-2 rounded-xl bg-brand-500 px-6 py-2.5 text-sm font-bold text-white hover:bg-brand-600 disabled:opacity-50 transition-all"
            >
              <Lock size={14} />
              {isStaking ? "Staking..." : "Stake Selected"}
            </button>
          </div>
        )}

        {poolAddress && activeTab === "staked" && stakedNfts.length > 0 && (
          <div className="flex items-center justify-between rounded-xl bg-mint-500/10 border border-mint-500/20 p-4">
            <div className="flex items-center gap-2">
              <Coins size={20} className="text-mint-400" />
              <span className="text-sm font-medium text-white/80">
                Pending Rewards:{" "}
                <span className="text-mint-400 font-bold">
                  {(pendingRewards / 10_000_000).toLocaleString(undefined, {
                    maximumFractionDigits: 7,
                  })}
                </span>
              </span>
            </div>
            <button
              onClick={handleClaimRewards}
              disabled={isClaiming || pendingRewards <= 0}
              className="flex items-center gap-2 rounded-xl bg-mint-500 px-6 py-2.5 text-sm font-bold text-midnight-950 hover:bg-mint-400 disabled:opacity-50 transition-all"
            >
              <Coins size={14} />
              {isClaiming ? "Claiming..." : "Claim All Rewards"}
            </button>
          </div>
        )}

        {/* Content grids */}
        {poolAddress && activeTab === "unstaked" && (
          <>
            {nftsLoading && <LoadingGrid />}
            {!nftsLoading && unstakedNfts.length === 0 && (
              <EmptyState
                icon={<Layers size={32} />}
                title="No unstaked NFTs"
                description={
                  stakedNfts.length > 0
                    ? "All your NFTs from this collection are staked."
                    : "You don't own any NFTs from this collection."
                }
              />
            )}
            {!nftsLoading && unstakedNfts.length > 0 && (
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {unstakedNfts.map((nft) => {
                  const nftId = `${nft.collectionAddress}-${nft.tokenId}`;
                  const isSelected = selectedIds.has(nftId);
                  return (
                    <button
                      key={nftId}
                      onClick={() => toggleSelect(nftId)}
                      className={`relative rounded-2xl border overflow-hidden bg-white/5 backdrop-blur-md text-left transition-all hover-lift ${
                        isSelected
                          ? "border-brand-500 shadow-lg shadow-brand-500/20"
                          : "border-white/5 hover:border-white/10"
                      }`}
                    >
                      {isSelected && (
                        <div className="absolute top-3 right-3 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-brand-500 text-white text-xs font-bold">
                          ✓
                        </div>
                      )}
                      <div className="aspect-square bg-white/5 flex items-center justify-center">
                        {nft.image ? (
                          <img
                            src={nft.image}
                            alt={nft.name || `NFT #${nft.tokenId}`}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Layers size={48} className="text-white/20" />
                        )}
                      </div>
                      <div className="p-4">
                        <p className="font-display font-bold text-white truncate">
                          {nft.name || `NFT #${nft.tokenId}`}
                        </p>
                        <p className="text-xs font-mono text-white/40 truncate mt-1">
                          #{nft.tokenId}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        {poolAddress && activeTab === "staked" && (
          <>
            {isLoadingStaked && <LoadingGrid />}
            {!isLoadingStaked && stakedNfts.length === 0 && (
              <EmptyState
                icon={<Lock size={32} />}
                title="No staked NFTs"
                description="Select unstaked NFTs and stake them to start earning rewards."
              />
            )}
            {!isLoadingStaked && stakedNfts.length > 0 && (
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {stakedNfts.map((nft) => (
                  <div
                    key={nft.id}
                    className="relative rounded-2xl border border-white/5 bg-white/5 backdrop-blur-md overflow-hidden"
                  >
                    <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 rounded-full bg-mint-500/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-midnight-950">
                      <Lock size={10} />
                      Staked
                    </div>
                    <div className="aspect-square bg-white/5 flex items-center justify-center">
                      <Layers size={48} className="text-white/20" />
                    </div>
                    <div className="p-4 space-y-3">
                      <p className="font-display font-bold text-white truncate">
                        {nft.name || `NFT #${nft.tokenId}`}
                      </p>
                      <div className="flex items-center gap-1.5 text-sm text-mint-400">
                        <Coins size={14} />
                        <span className="font-medium">{nft.rewardsEarned}</span>
                      </div>
                      <button
                        onClick={() =>
                          handleUnstake(nft.collectionAddress, nft.tokenId)
                        }
                        disabled={isUnstaking}
                        className="w-full flex items-center justify-center gap-2 rounded-xl border border-white/10 px-4 py-2 text-sm font-medium text-white/60 hover:bg-white/5 hover:text-white disabled:opacity-50 transition-all"
                      >
                        <Unlock size={14} />
                        {isUnstaking ? "Unstaking..." : "Unstake"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {!poolAddress && !isLoadingPool && !activeCollection && (
          <EmptyState
            icon={<Search size={32} />}
            title="Select a collection"
            description="Paste an NFT contract address above to load its staking pool and start earning rewards."
          />
        )}
      </div>
    </main>
  );
}

function LoadingGrid() {
  return (
    <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-2xl border border-white/5 bg-white/5 overflow-hidden"
        >
          <div className="aspect-square bg-white/5" />
          <div className="p-4 space-y-3">
            <div className="h-4 w-3/4 rounded bg-white/5" />
            <div className="h-3 w-1/2 rounded bg-white/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-20">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5 border border-white/10 text-brand-400 mb-4">
        {icon}
      </div>
      <h3 className="font-display font-bold text-white text-lg">{title}</h3>
      <p className="mt-1 text-sm text-white/60 max-w-sm text-center">
        {description}
      </p>
    </div>
  );
}

export default function StakingPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-midnight-950 flex items-center justify-center">
          <Loader2 size={32} className="animate-spin text-brand-400" />
        </main>
      }
    >
      <StakingPageContent />
    </Suspense>
  );
}
