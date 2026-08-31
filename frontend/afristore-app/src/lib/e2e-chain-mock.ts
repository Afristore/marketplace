// In-memory chain mock for Playwright E2E (NEXT_PUBLIC_E2E_MOCK_CHAIN=true).

import { DEFAULT_TOKEN } from "@/config/tokens";
import type { Listing, Auction } from "./contract";

let nextListingId = 9001;
const listings = new Map<number, Listing>();

let nextAuctionId = 8001;
const auctions = new Map<number, Auction>();

let nextCollectionId = 1;
export interface E2eMockCollection {
  name: string;
  symbol: string;
  creator: string;
  totalSupply: number;
  maxSupply: number;
  royaltyBps: number;
  royaltyReceiver: string;
}
const collections = new Map<string, E2eMockCollection>();

let nextSplitterId = 1;
export interface E2eMockSplitter {
  owner: string;
  recipients: Array<{ address: string; percentage: number }>;
}
const splitters = new Map<string, E2eMockSplitter>();

declare global {
  interface Window {
    __E2E_GET_LISTINGS__?: () => Listing[];
    __E2E_RESET_LISTINGS__?: () => void;
    __E2E_GET_AUCTIONS__?: () => Auction[];
    __E2E_RESET_AUCTIONS__?: () => void;
    __E2E_SEED_AUCTION__?: (auction: Auction) => void;
    __E2E_REJECT_NEXT_TX__?: boolean;
    __E2E_NEXT_TX_ERROR__?: string;
    __E2E_SEED_STAKING_POOL__?: (nftAddress: string, rewardRate?: bigint) => string;
    __E2E_GET_USER_STAKES__?: (publicKey: string) => E2eMockUserStake[];
    __E2E_RESET_STAKING__?: () => void;
    __E2E_GET_SPLITTER__?: (address: string) => E2eMockSplitter | undefined;
  }
}

/** User-declined-signature error, matching Freighter's own rejection message. */
const FREIGHTER_REJECTION_MESSAGE = "User declined access";

function consumeForcedRejection(): void {
  if (typeof window !== "undefined") {
    if (window.__E2E_NEXT_TX_ERROR__) {
      const msg = window.__E2E_NEXT_TX_ERROR__;
      window.__E2E_NEXT_TX_ERROR__ = undefined;
      throw new Error(msg);
    }
    if (window.__E2E_REJECT_NEXT_TX__) {
      window.__E2E_REJECT_NEXT_TX__ = false;
      throw new Error(FREIGHTER_REJECTION_MESSAGE);
    }
  }
}

export function isE2eMockChain(): boolean {
  return process.env.NEXT_PUBLIC_E2E_MOCK_CHAIN === "true";
}

export function resetE2eMockListings(): void {
  listings.clear();
  nextListingId = 9001;
}

export function getE2eMockListings(): Listing[] {
  return Array.from(listings.values());
}

export function resetE2eMockAuctions(): void {
  auctions.clear();
  nextAuctionId = 8001;
}

export function resetE2eMockCollections(): void {
  collections.clear();
  nextCollectionId = 1;
}

export function resetE2eMockSplitters(): void {
  splitters.clear();
  nextSplitterId = 1;
}

export function getE2eMockAuctions(): Auction[] {
  return Array.from(auctions.values());
}

export function getE2eMockAuction(auctionId: number): Auction {
  const auction = auctions.get(auctionId);
  if (!auction) {
    throw new Error(`Auction #${auctionId} not found`);
  }
  return { ...auction };
}

export function seedE2eMockAuction(auction: Auction): void {
  auctions.set(auction.auction_id, { ...auction });
}

export function registerE2eMockListingsOnWindow(): void {
  if (typeof window === "undefined") return;
  window.__E2E_GET_LISTINGS__ = getE2eMockListings;
  window.__E2E_RESET_LISTINGS__ = () => {
    resetE2eMockListings();
    resetE2eMockAuctions();
    resetE2eMockCollections();
    resetE2eMockSplitters();
    resetE2eMockStaking();
    resetE2eMockLending();
  };

  window.__E2E_SEED_STAKING_POOL__ = e2eMockSeedStakingPool;
  window.__E2E_GET_USER_STAKES__ = e2eMockGetUserStakes;
  window.__E2E_RESET_STAKING__ = resetE2eMockStaking;
  window.__E2E_GET_AUCTIONS__ = getE2eMockAuctions;
  window.__E2E_RESET_AUCTIONS__ = resetE2eMockAuctions;
  window.__E2E_SEED_AUCTION__ = seedE2eMockAuction;
  window.__E2E_GET_SPLITTER__ = getE2eMockSplitter;
  if (window.__E2E_REJECT_NEXT_TX__ === undefined) {
    window.__E2E_REJECT_NEXT_TX__ = false;
  }

  if (Array.isArray((window as any).__E2E_PENDING_AUCTIONS__)) {
    for (const a of (window as any).__E2E_PENDING_AUCTIONS__) {
      seedE2eMockAuction(a);
    }
  }
}

export function e2eMockDeployRoyaltySplitter(
  owner: string,
  recipients: Array<{ address: string; percentage: number }>,
): string {
  consumeForcedRejection();

  const address = `CB${"R".repeat(49)}${String(nextSplitterId++).padStart(5, "0")}`;
  splitters.set(address, {
    owner,
    recipients: recipients.map((recipient) => ({ ...recipient })),
  });
  return address;
}

export function getE2eMockSplitter(
  address: string,
): E2eMockSplitter | undefined {
  const splitter = splitters.get(address);
  if (!splitter) return undefined;
  return {
    owner: splitter.owner,
    recipients: splitter.recipients.map((recipient) => ({ ...recipient })),
  };
}
export function e2eMockCreateListing(
  artistPublicKey: string,
  price: number,
  tokenAddress: string = DEFAULT_TOKEN.address,
  collectionAddress: string,
  nftTokenId: number,
): number {
  consumeForcedRejection();

  const id = nextListingId++;
  const priceStroops = BigInt(Math.round(price * 10_000_000));
  listings.set(id, {
    listing_id: id,
    artist: artistPublicKey,
    collection: collectionAddress,
    token_id: nftTokenId,
    price: priceStroops,
    currency: DEFAULT_TOKEN.symbol,
    token: tokenAddress,
    recipients: [{ address: artistPublicKey, percentage: 100 }],
    status: "Active",
    owner: null,
    created_at: Math.floor(Date.now() / 1000),
  });
  return id;
}

export function e2eMockBuyArtwork(
  buyerPublicKey: string,
  listingId: number,
): boolean {
  const listing = listings.get(listingId);
  if (!listing || listing.status !== "Active") {
    throw new Error("Listing is not available for purchase.");
  }
  if (listing.artist === buyerPublicKey) {
    throw new Error("Cannot buy your own listing.");
  }
  listing.status = "Sold";
  listing.owner = buyerPublicKey;
  return true;
}

export function e2eMockPlaceBid(
  bidderPublicKey: string,
  auctionId: number,
  amountXlm: number,
): boolean {
  consumeForcedRejection();

  const auction = auctions.get(auctionId);
  if (!auction) {
    throw new Error(`Auction #${auctionId} not found`);
  }
  if (auction.status !== "Active") {
    throw new Error("Auction is not active");
  }
  const amountStroops = BigInt(Math.round(amountXlm * 10_000_000));
  auction.highest_bid = amountStroops;
  auction.highest_bidder = bidderPublicKey;
  return true;
}

export function e2eMockDeployCollection(
  creatorPublicKey: string,
  name: string,
  symbol = "MOCK",
  maxSupply = 10000,
  royaltyBps = 500,
  royaltyReceiver?: string,
): string {
  consumeForcedRejection();

  const address = `CB${"A".repeat(49)}${String(nextCollectionId++).padStart(5, "0")}`;
  collections.set(address, {
    name,
    symbol,
    creator: creatorPublicKey,
    totalSupply: 0,
    maxSupply,
    royaltyBps,
    royaltyReceiver: royaltyReceiver || creatorPublicKey,
  });
  return address;
}

export function getE2eMockCollection(address: string): E2eMockCollection {
  return (
    collections.get(address) ?? {
      name: "Mock Collection",
      symbol: "MOCK",
      creator: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
      totalSupply: 0,
      maxSupply: 10000,
      royaltyBps: 500,
      royaltyReceiver: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    }
  );
}

export function e2eMockFinalizeAuction(
  callerPublicKey: string,
  auctionId: number,
): boolean {
  const auction = auctions.get(auctionId);
  if (!auction) {
    throw new Error(`Auction #${auctionId} not found`);
  }
  auction.status = "Finalized";
  return true;
}

// ── Staking pool mocks ─────────────────────────────────────────

export interface E2eMockStakingPoolConfig {
  nftAddress: string;
  rewardToken: string;
  rewardRate: bigint;
}

export interface E2eMockUserStake {
  owner: string;
  token_address: string;
  token_id: number;
  staked_at: number;
  rewards_earned: string;
}

const stakingPools = new Map<string, string>(); // nftAddress -> poolAddress
const stakingPoolConfigs = new Map<string, E2eMockStakingPoolConfig>(); // poolAddress -> config
const userStakes = new Map<string, E2eMockUserStake[]>(); // publicKey -> stakes
let nextPoolId = 1;

export function resetE2eMockStaking(): void {
  stakingPools.clear();
  stakingPoolConfigs.clear();
  userStakes.clear();
  nextPoolId = 1;
}

/** Seed a staking pool for the given NFT collection address. Returns the pool address. */
export function e2eMockSeedStakingPool(
  nftAddress: string,
  rewardRate: bigint = 100n,
): string {
  const poolAddress = `CB${"B".repeat(49)}${String(nextPoolId++).padStart(5, "0")}`;
  stakingPools.set(nftAddress, poolAddress);
  stakingPoolConfigs.set(poolAddress, {
    nftAddress,
    rewardToken: "CBXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
    rewardRate,
  });
  return poolAddress;
}

export function e2eMockGetStakingPoolByNft(nftAddress: string): string | null {
  return stakingPools.get(nftAddress) ?? null;
}

export function e2eMockGetStakingPoolConfig(
  poolAddress: string,
): E2eMockStakingPoolConfig {
  const cfg = stakingPoolConfigs.get(poolAddress);
  if (!cfg) throw new Error(`Staking pool ${poolAddress} not found`);
  return cfg;
}

export function e2eMockTotalStaked(poolAddress: string): number {
  let count = 0;
  for (const stakes of userStakes.values()) {
    count += stakes.filter((s) => {
      const cfg = stakingPoolConfigs.get(poolAddress);
      return cfg && s.token_address === cfg.nftAddress;
    }).length;
  }
  return count;
}

export function e2eMockStake(
  userPublicKey: string,
  tokenAddress: string,
  tokenId: number,
): void {
  consumeForcedRejection();
  const existing = userStakes.get(userPublicKey) || [];
  existing.push({
    owner: userPublicKey,
    token_address: tokenAddress,
    token_id: tokenId,
    staked_at: Math.floor(Date.now() / 1000),
    rewards_earned: "0",
  });
  userStakes.set(userPublicKey, existing);
}

export function e2eMockUnstake(
  userPublicKey: string,
  tokenAddress: string,
  tokenId: number,
): void {
  const existing = userStakes.get(userPublicKey) || [];
  userStakes.set(
    userPublicKey,
    existing.filter(
      (s) => !(s.token_address === tokenAddress && s.token_id === tokenId),
    ),
  );
}

export function e2eMockGetUserStakes(
  userPublicKey: string,
): E2eMockUserStake[] {
  return userStakes.get(userPublicKey) || [];
}

export function e2eMockGetStakedPosition(
  userPublicKey: string,
  tokenAddress: string,
  tokenId: number,
): E2eMockUserStake | null {
  const stakes = userStakes.get(userPublicKey) || [];
  return (
    stakes.find(
      (s) => s.token_address === tokenAddress && s.token_id === tokenId,
    ) ?? null
  );
}

export function e2eMockCalculateRewards(userPublicKey: string): number {
  const stakes = userStakes.get(userPublicKey) || [];
  if (stakes.length === 0) return 0;
  // Simulate accumulated rewards: 100 token units per staked NFT
  return stakes.length * 100;
}

export function e2eMockClaimRewards(userPublicKey: string): number {
  consumeForcedRejection();
  const rewards = e2eMockCalculateRewards(userPublicKey);
  // Reset rewards for all stakes
  const stakes = userStakes.get(userPublicKey) || [];
  for (const s of stakes) {
    s.rewards_earned = "0";
  }
  return rewards;
}

// ── Lending admin mocks ───────────────────────────────────────

export interface E2eMockLendingBounds {
  minBufferBps: number;
  maxBufferBps: number;
  minLiqThresholdBps: number;
  maxLiqThresholdBps: number;
}

/** Well-known mock protocol admin, matching the read-only caller key. */
export const E2E_MOCK_LENDING_ADMIN =
  "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

const whitelistedCurrencies = new Set<string>();
const currencySymbols = new Map<string, string>();
let lendingBounds: E2eMockLendingBounds = {
  minBufferBps: 12000,
  maxBufferBps: 20000,
  minLiqThresholdBps: 10500,
  maxLiqThresholdBps: 12000,
};

export function resetE2eMockLending(): void {
  whitelistedCurrencies.clear();
  currencySymbols.clear();
  lendingBounds = {
    minBufferBps: 12000,
    maxBufferBps: 20000,
    minLiqThresholdBps: 10500,
    maxLiqThresholdBps: 12000,
  };
}

export function e2eMockWhitelistCurrency(
  currencyAddress: string,
  symbol: string,
): void {
  consumeForcedRejection();
  whitelistedCurrencies.add(currencyAddress);
  currencySymbols.set(currencyAddress, symbol);
}

export function e2eMockWhitelistedCurrencies(): string[] {
  return Array.from(whitelistedCurrencies.values());
}

export function e2eMockUpdateBounds(bounds: E2eMockLendingBounds): void {
  consumeForcedRejection();
  lendingBounds = { ...bounds };
}

export function e2eMockLendingBounds(): E2eMockLendingBounds {
  return { ...lendingBounds };
}

export function e2eMockLendingAdmin(): string {
  return E2E_MOCK_LENDING_ADMIN;
}

