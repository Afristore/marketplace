"use client";

import {
  Contract,
  xdr,
  nativeToScVal,
  scValToNative,
  Address,
} from "@stellar/stellar-sdk";
import { invokeContract } from "./contract";
import { getConnectedPublicKey } from "./freighter";
import {
  isE2eMockChain,
  e2eMockStake,
  e2eMockUnstake,
  e2eMockClaimRewards,
  e2eMockCalculateRewards,
  e2eMockGetStakingPoolConfig,
  e2eMockTotalStaked,
  e2eMockGetUserStakes,
  e2eMockGetStakedPosition,
  registerE2eMockListingsOnWindow,
} from "./e2e-chain-mock";

export interface StakedPosition {
  owner: string;
  token_address: string;
  token_id: number;
  staked_at: number;
  rewards_earned: string;
}

export interface StakingPoolConfig {
  nftAddress: string;
  rewardToken: string;
  rewardRate: bigint;
}

export interface StakedNFTIndexerRow {
  id: number;
  owner: string;
  tokenAddress: string;
  tokenId: string;
  collection: string;
  stakedAt: string;
  status: string;
  rewardsEarned: string;
  createdAtLedger: number;
  updatedAtLedger: number;
}

export const STAKING_CONTRACT_ID =
  process.env.NEXT_PUBLIC_STAKING_CONTRACT_ID || "";

const SECONDS_PER_YEAR = 31_536_000n;

function resolveStakingContractId(poolContractId?: string): string {
  const id = poolContractId || STAKING_CONTRACT_ID;
  if (!id) {
    throw new Error("Staking pool contract ID not configured");
  }
  return id;
}

export function getStakingContract(poolContractId?: string): Contract {
  return new Contract(resolveStakingContractId(poolContractId));
}

/**
 * Thin wrapper over the shared `invokeContract`, so staking reads use the
 * same synthetic read-only account as marketplace reads instead of
 * requiring the caller to be funded on-chain.
 */
async function invokeStakingContract(
  callerPublicKey: string,
  method: string,
  args: xdr.ScVal[],
  readonly = false,
  poolContractId?: string,
): Promise<xdr.ScVal> {
  return invokeContract(
    callerPublicKey,
    method,
    args,
    { readonly },
    resolveStakingContractId(poolContractId),
  );
}

export async function stake(
  userPublicKey: string,
  tokenAddress: string,
  tokenId: number,
  poolContractId?: string,
): Promise<void> {
  try {
    if (isE2eMockChain()) {
      if (typeof window !== "undefined") registerE2eMockListingsOnWindow();
      e2eMockStake(userPublicKey, tokenAddress, tokenId);
      return;
    }
    const args: xdr.ScVal[] = [
      new Address(userPublicKey).toScVal(),
      new Address(tokenAddress).toScVal(),
      nativeToScVal(BigInt(tokenId), { type: "u64" }),
    ];
    await invokeStakingContract(userPublicKey, "stake", args, false, poolContractId);
  } catch (error) {
    console.error("Staking error in stake:", error);
    throw error;
  }
}

export async function unstake(
  userPublicKey: string,
  tokenAddress: string,
  tokenId: number,
  poolContractId?: string,
): Promise<void> {
  try {
    if (isE2eMockChain()) {
      if (typeof window !== "undefined") registerE2eMockListingsOnWindow();
      e2eMockUnstake(userPublicKey, tokenAddress, tokenId);
      return;
    }
    const args: xdr.ScVal[] = [
      new Address(userPublicKey).toScVal(),
      new Address(tokenAddress).toScVal(),
      nativeToScVal(BigInt(tokenId), { type: "u64" }),
    ];
    await invokeStakingContract(userPublicKey, "unstake", args, false, poolContractId);
  } catch (error) {
    console.error("Staking error in unstake:", error);
    throw error;
  }
}

export async function claimRewards(
  userPublicKey: string,
  poolContractId?: string,
): Promise<number> {
  try {
    if (isE2eMockChain()) {
      if (typeof window !== "undefined") registerE2eMockListingsOnWindow();
      return e2eMockClaimRewards(userPublicKey);
    }
    const args: xdr.ScVal[] = [new Address(userPublicKey).toScVal()];
    const retVal = await invokeStakingContract(
      userPublicKey,
      "claim_rewards",
      args,
      false,
      poolContractId,
    );
    return Number(scValToNative(retVal));
  } catch (error) {
    console.error("Staking error in claimRewards:", error);
    throw error;
  }
}

export async function getStakedPosition(
  userPublicKey: string,
  tokenAddress: string,
  tokenId: number,
  poolContractId?: string,
): Promise<StakedPosition | null> {
  try {
    if (isE2eMockChain()) {
      const pos = e2eMockGetStakedPosition(userPublicKey, tokenAddress, tokenId);
      if (!pos) return null;
      return {
        owner: pos.owner,
        token_address: pos.token_address,
        token_id: pos.token_id,
        staked_at: pos.staked_at,
        rewards_earned: pos.rewards_earned,
      };
    }
    const caller = await getConnectedPublicKey();
    const pk = caller ?? userPublicKey;
    const retVal = await invokeStakingContract(
      pk,
      "get_staked_position",
      [
        new Address(userPublicKey).toScVal(),
        new Address(tokenAddress).toScVal(),
        nativeToScVal(BigInt(tokenId), { type: "u64" }),
      ],
      true,
      poolContractId,
    );
    const raw = scValToNative(retVal);
    if (!raw) return null;
    const obj = raw as Record<string, unknown>;
    return {
      owner: (obj["owner"] as Address).toString(),
      token_address: (obj["token_address"] as Address).toString(),
      token_id: Number(obj["token_id"]),
      staked_at: Number(obj["staked_at"]),
      rewards_earned: String(obj["rewards_earned"] ?? "0"),
    };
  } catch (error) {
    console.error("Staking error in getStakedPosition:", error);
    throw error;
  }
}

export async function getUserStakes(
  userPublicKey: string,
  poolContractId?: string,
): Promise<StakedPosition[]> {
  try {
    if (isE2eMockChain()) {
      return e2eMockGetUserStakes(userPublicKey).map((p) => ({
        owner: p.owner,
        token_address: p.token_address,
        token_id: p.token_id,
        staked_at: p.staked_at,
        rewards_earned: p.rewards_earned,
      }));
    }
    const caller = await getConnectedPublicKey();
    const pk = caller ?? userPublicKey;
    const retVal = await invokeStakingContract(
      pk,
      "get_user_stakes",
      [new Address(userPublicKey).toScVal()],
      true,
      poolContractId,
    );
    const raw = scValToNative(retVal) as Record<string, unknown>[];
    return raw.map((obj) => ({
      owner: (obj["owner"] as Address).toString(),
      token_address: (obj["token_address"] as Address).toString(),
      token_id: Number(obj["token_id"]),
      staked_at: Number(obj["staked_at"]),
      rewards_earned: String(obj["rewards_earned"] ?? "0"),
    }));
  } catch (error) {
    console.error("Staking error in getUserStakes:", error);
    throw error;
  }
}

export async function calculateRewards(
  userPublicKey: string,
  poolContractId?: string,
): Promise<number> {
  try {
    if (isE2eMockChain()) {
      return e2eMockCalculateRewards(userPublicKey);
    }
    const caller = await getConnectedPublicKey();
    const pk = caller ?? userPublicKey;
    const retVal = await invokeStakingContract(
      pk,
      "calculate_rewards",
      [new Address(userPublicKey).toScVal()],
      true,
      poolContractId,
    );
    return Number(scValToNative(retVal));
  } catch (error) {
    console.error("Staking error in calculateRewards:", error);
    throw error;
  }
}

export async function isStakingPaused(
  poolContractId?: string,
): Promise<boolean> {
  try {
    if (isE2eMockChain()) return false;
    const caller = await getConnectedPublicKey();
    if (!caller) return false;
    const retVal = await invokeStakingContract(
      caller,
      "is_paused",
      [],
      true,
      poolContractId,
    );
    return Boolean(scValToNative(retVal));
  } catch (error) {
    console.error("Staking error in isStakingPaused:", error);
    throw error;
  }
}

export async function totalStaked(poolContractId?: string): Promise<number> {
  try {
    if (isE2eMockChain()) {
      return e2eMockTotalStaked(poolContractId || "");
    }
    const caller = await getConnectedPublicKey();
    if (!caller) return 0;
    const retVal = await invokeStakingContract(
      caller,
      "total_staked",
      [],
      true,
      poolContractId,
    );
    return Number(scValToNative(retVal));
  } catch (error) {
    console.error("Staking error in totalStaked:", error);
    throw error;
  }
}

export async function getStakingPoolConfig(
  poolContractId: string,
): Promise<StakingPoolConfig> {
  try {
    if (isE2eMockChain()) {
      const mock = e2eMockGetStakingPoolConfig(poolContractId);
      return {
        nftAddress: mock.nftAddress,
        rewardToken: mock.rewardToken,
        rewardRate: mock.rewardRate,
      };
    }
    const simulationAccount = await getConnectedPublicKey();
    if (!simulationAccount) {
      throw new Error("Connect a wallet to query staking pool details.");
    }

    const [nftVal, tokenVal, rateVal] = await Promise.all([
      invokeStakingContract(simulationAccount, "get_nft_address", [], true, poolContractId),
      invokeStakingContract(simulationAccount, "get_reward_token", [], true, poolContractId),
      invokeStakingContract(simulationAccount, "get_reward_rate", [], true, poolContractId),
    ]);

    return {
      nftAddress: (scValToNative(nftVal) as Address).toString(),
      rewardToken: (scValToNative(tokenVal) as Address).toString(),
      rewardRate: BigInt(scValToNative(rateVal) as string | number | bigint),
    };
  } catch (error) {
    console.error("Staking error in getStakingPoolConfig:", error);
    throw error;
  }
}

/** Estimated annual reward tokens per staked NFT (7 decimal stroops). */
export function formatAnnualYieldPerNft(rewardRate: bigint): string {
  const annual = rewardRate * SECONDS_PER_YEAR;
  const whole = annual / 10_000_000n;
  const frac = annual % 10_000_000n;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(7, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

/** Simple APY proxy: annual tokens per NFT when exactly one NFT is staked. */
export function estimateApyPercent(
  rewardRate: bigint,
  stakedCount: number,
): string {
  if (stakedCount <= 0 || rewardRate <= 0n) {
    const annual = rewardRate * SECONDS_PER_YEAR;
    if (annual <= 0n) return "0";
    return "—";
  }
  const annualPerNft =
    Number(rewardRate * SECONDS_PER_YEAR) / stakedCount / 10_000_000;
  return annualPerNft.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  });
}

export function formatRewardRatePerDay(rewardRate: bigint): string {
  const daily = rewardRate * 86_400n;
  const whole = daily / 10_000_000n;
  const frac = daily % 10_000_000n;
  if (frac === 0n) return whole.toString();
  const fracStr = frac.toString().padStart(7, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}
