// ─────────────────────────────────────────────────────────────
// lib/contract.ts — Soroban Marketplace contract client
//
// All blockchain interaction flows through this module.
// It builds transactions, simulates them, and submits via
// Stellar SDK + Freighter signing.
// ─────────────────────────────────────────────────────────────

import {
  Contract,
  SorobanRpc,
  TransactionBuilder,
  xdr,
  nativeToScVal,
  scValToNative,
  Address,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import { config } from "./config";
import { getConnectedPublicKey, signWithFreighter } from "./freighter";
import { mapSorobanErrorMessage } from "./errors";
import {
  isE2eMockChain,
  e2eMockCreateListing,
  e2eMockBuyArtwork,
  getE2eMockListings,
  registerE2eMockListingsOnWindow,
  e2eMockPlaceBid,
  e2eMockFinalizeAuction,
  getE2eMockAuction,
} from "./e2e-chain-mock";
import {
  DEFAULT_TOKEN,
  TokenConfig,
  getTokenConfigByAddress,
} from "@/config/tokens";
import { fetchListings, fetchAuctions } from "./indexer";

// ── Types mirrored from the Rust contract ────────────────────

export type ListingStatus = "Active" | "Sold" | "Cancelled";

export interface Recipient {
  address: string;
  percentage: number;
}

export interface Listing {
  listing_id: number;
  artist: string;
  metadata_cid?: string;
  collection: string;
  token_id: number;
  price: bigint;
  currency: string;
  token: string;
  recipients: Recipient[];
  status: ListingStatus;
  owner: string | null;
  created_at: number;
}

export type AuctionStatus = "Active" | "Finalized" | "Cancelled";

export interface Auction {
  auction_id: number;
  creator: string;
  metadata_cid?: string;
  collection: string;
  token_id: number;
  token: string;
  reserve_price: bigint;
  highest_bid: bigint;
  highest_bidder: string | null;
  end_time: number;
  status: AuctionStatus;
  recipients: Recipient[];
  created_at: number;
}

// ── Soroban RPC server ────────────────────────────────────────

function getRpc(): SorobanRpc.Server {
  return new SorobanRpc.Server(config.rpcUrl, { allowHttp: false });
}

export function getContract(contractId: string = config.contractId): Contract {
  return new Contract(contractId);
}

function getNetworkPassphrase(): string {
  return config.networkPassphrase;
}

const READ_ONLY_CALLER_PUBLIC_KEY =
  "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

async function getReadOnlyCallerPublicKey(): Promise<string> {
  const connectedPublicKey = await getConnectedPublicKey();
  return connectedPublicKey ?? READ_ONLY_CALLER_PUBLIC_KEY;
}
function resolveConfiguredToken(
  tokenAddress: string = DEFAULT_TOKEN.address,
): TokenConfig {
  const token = getTokenConfigByAddress(tokenAddress);
  if (!token) {
    throw new Error(`Unsupported token address: ${tokenAddress}`);
  }

  return token;
}

// ── Invoke helper ─────────────────────────────────────────────

/**
 * Builds, simulates, signs (via Freighter), and submits a contract
 * invocation transaction. Returns the simulation result for read-only
 * calls, or the ledger result for state-changing calls.
 */
export async function invokeContract(
  callerPublicKey: string,
  method: string,
  args: xdr.ScVal[],
  readonly = false,
  contractId: string = config.contractId,
): Promise<xdr.ScVal> {
  const readableError = (raw: string, fallback: string): Error => {
    const mapped = mapSorobanErrorMessage(raw);
    return new Error(mapped ?? fallback);
  };

  const rpc = getRpc();
  const contract = getContract(contractId);

  // Fetch the caller's account for the sequence number.
  const account = await rpc.getAccount(callerPublicKey);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: getNetworkPassphrase(),
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  // Simulate to get the resource fee + footprint.
  const simResult = await rpc.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(simResult)) {
    const raw = String(simResult.error ?? "");
    throw readableError(raw, "Unable to simulate this transaction.");
  }

  if (readonly) {
    // For read-only calls return the simulated result directly.
    const retVal = (
      simResult as SorobanRpc.Api.SimulateTransactionSuccessResponse
    ).result?.retval;
    if (!retVal) throw new Error("No return value from simulation.");
    return retVal;
  }

  // Assemble the transaction with the real resource fee.
  const preparedTx = SorobanRpc.assembleTransaction(tx, simResult).build();
  const txXdr = preparedTx.toXDR();

  // Sign via Freighter.
  const signedXdr = await signWithFreighter(txXdr, getNetworkPassphrase());

  // Submit.
  const submitted = await rpc.sendTransaction(
    TransactionBuilder.fromXDR(signedXdr, getNetworkPassphrase()),
  );

  if (submitted.status === "ERROR") {
    const raw = String(submitted.errorResult ?? "");
    throw readableError(raw, "Transaction submission failed.");
  }

  // Poll for completion.
  let getResult = await rpc.getTransaction(submitted.hash);
  while (getResult.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
    await new Promise((r) => setTimeout(r, 1000));
    getResult = await rpc.getTransaction(submitted.hash);
  }

  if (getResult.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
    const raw = JSON.stringify(getResult);
    throw readableError(raw, "Transaction failed on-chain. Please try again.");
  }

  const successResult =
    getResult as SorobanRpc.Api.GetSuccessfulTransactionResponse;
  return successResult.returnValue ?? xdr.ScVal.scvVoid();
}

// ── ScVal parsing ─────────────────────────────────────────────

function parseRecipient(obj: any): Recipient {
  return {
    address: (obj["address"] as Address).toString(),
    percentage: Number(obj["percentage"]),
  };
}

function parseListingFromScVal(raw: unknown): Listing {
  const obj = scValToNative(raw as xdr.ScVal) as Record<string, unknown>;

  return {
    listing_id: Number(obj["listing_id"]),
    artist: (obj["artist"] as Address).toString(),
    collection: (obj["collection"] as any).toString(),
    token_id: Number(obj["nft_token_id"]),
    price: BigInt(obj["price"] as bigint),
    currency: String(obj["currency"]),
    token: (obj["token"] as any).toString(),
    recipients: (obj["recipients"] as any[]).map(parseRecipient),
    status: String(obj["status"]) as ListingStatus,
    owner: obj["owner"] ? (obj["owner"] as any).toString() : null,
    created_at: Number(obj["created_at"]),
  };
}

function parseAuctionFromScVal(raw: unknown): Auction {
  const obj = scValToNative(raw as xdr.ScVal) as Record<string, unknown>;

  return {
    auction_id: Number(obj["auction_id"]),
    creator: (obj["creator"] as Address).toString(),
    collection: (obj["collection"] as any).toString(),
    token_id: Number(obj["nft_token_id"]),
    token: (obj["token"] as any).toString(),
    reserve_price: BigInt(obj["reserve_price"] as bigint),
    highest_bid: BigInt(obj["highest_bid"] as bigint),
    highest_bidder: obj["highest_bidder"]
      ? (obj["highest_bidder"] as any).toString()
      : null,
    end_time: Number(obj["end_time"]),
    status: String(obj["status"]) as AuctionStatus,
    recipients: (obj["recipients"] as any[]).map(parseRecipient),
    created_at: Number(obj["created_at"] || 0),
  };
}

// ── Listing contract methods ──────────────────────────────────

/**
 * create_listing — Artist creates a new on-chain listing.
 */
export async function createListing(
  artistPublicKey: string,
  price: number,
  tokenAddress: string = DEFAULT_TOKEN.address,
  collectionAddress: string,
  nftTokenId: number,
  recipients: Array<{ address: string; percentage: number }> = [],
): Promise<number> {
  if (isE2eMockChain()) {
    if (typeof window !== "undefined") registerE2eMockListingsOnWindow();
    return e2eMockCreateListing(
      artistPublicKey,
      price,
      tokenAddress,
      collectionAddress,
      nftTokenId,
    );
  }

  const priceStroops = xlmToStroops(price);
  const selectedToken = resolveConfiguredToken(tokenAddress);

  // If no recipients provided, default to 100% to the artist
  const finalRecipients =
    recipients.length > 0
      ? recipients
      : [{ address: artistPublicKey, percentage: 100 }];

  const args: xdr.ScVal[] = [
    new Address(artistPublicKey).toScVal(),
    nativeToScVal(priceStroops, { type: "i128" }),
    nativeToScVal(selectedToken.symbol, { type: "symbol" }),
    new Address(selectedToken.address).toScVal(),
    new Address(collectionAddress).toScVal(),
    nativeToScVal(nftTokenId, { type: "u64" }),
    nativeToScVal(
      finalRecipients.map((r) => ({
        address: new Address(r.address),
        percentage: r.percentage,
      })),
      { type: "vec" },
    ),
  ];

  const retVal = await invokeContract(artistPublicKey, "create_listing", args);
  return Number(scValToNative(retVal));
}

/**
 * buy_artwork — Buyer purchases a listed artwork.
 */
export async function buyArtwork(
  buyerPublicKey: string,
  listingId: number,
): Promise<boolean> {
  if (isE2eMockChain()) {
    if (typeof window !== "undefined") registerE2eMockListingsOnWindow();
    return e2eMockBuyArtwork(buyerPublicKey, listingId);
  }

  const args: xdr.ScVal[] = [
    new Address(buyerPublicKey).toScVal(),
    nativeToScVal(BigInt(listingId), { type: "u64" }),
  ];

  await invokeContract(buyerPublicKey, "buy_artwork", args);
  return true;
}

/**
 * cancel_listing — Artist cancels their active listing.
 */
export async function cancelListing(
  artistPublicKey: string,
  listingId: number,
): Promise<boolean> {
  const args: xdr.ScVal[] = [
    new Address(artistPublicKey).toScVal(),
    nativeToScVal(BigInt(listingId), { type: "u64" }),
  ];

  await invokeContract(artistPublicKey, "cancel_listing", args);
  return true;
}

/**
 * update_listing — Artist updates an active listing with new metadata or price.
 */
export async function updateListing(
  artistPublicKey: string,
  listingId: number,
  newMetadataCid: string,
  newPrice: number,
  newTokenAddress: string,
  newRecipients: Array<{ address: string; percentage: number }> = [],
): Promise<boolean> {
  const priceStroops = xlmToStroops(newPrice);
  const selectedToken = resolveConfiguredToken(newTokenAddress);

  const args: xdr.ScVal[] = [
    new Address(artistPublicKey).toScVal(),
    nativeToScVal(BigInt(listingId), { type: "u64" }),
    nativeToScVal(Buffer.from(newMetadataCid, "utf-8"), { type: "bytes" }),
    nativeToScVal(priceStroops, { type: "i128" }),
    new Address(selectedToken.address).toScVal(),
    nativeToScVal(
      newRecipients.map((r) => ({
        address: new Address(r.address),
        percentage: r.percentage,
      })),
      { type: "vec" },
    ),
  ];

  await invokeContract(artistPublicKey, "update_listing", args);
  return true;
}

/**
 * get_listing — Fetch a single listing by ID.
 */
export async function getListing(listingId: number): Promise<Listing> {
  const callerPublicKey = await getReadOnlyCallerPublicKey();
  const args = [nativeToScVal(BigInt(listingId), { type: "u64" })];
  const retVal = await invokeContract(
    callerPublicKey,
    "get_listing",
    args,
    true,
  );
  return parseListingFromScVal(retVal);
}

/**
 * get_total_listings — Read the total listing count.
 */
export async function getTotalListings(): Promise<number> {
  const callerPublicKey = await getReadOnlyCallerPublicKey();
  const retVal = await invokeContract(
    callerPublicKey,
    "get_total_listings",
    [],
    true,
  );
  return Number(scValToNative(retVal));
}

/**
 * get_artist_listings — Fetch all listing IDs for an artist.
 */
export async function getArtistListings(
  artistPublicKey: string,
): Promise<number[]> {
  const callerPublicKey = await getReadOnlyCallerPublicKey();
  const args = [new Address(artistPublicKey).toScVal()];
  const retVal = await invokeContract(
    callerPublicKey,
    "get_artist_listings",
    args,
    true,
  );
  const ids = scValToNative(retVal) as bigint[];
  return ids.map(Number);
}

/**
 * getAllListings — Fetch listings using indexer if possible, fallback to on-chain scan.
 * getAllListings — Fetch every listing from ID 1 up to total.
 * Uses batching to avoid excessive parallel RPC calls.
 */
export async function getAllListings(): Promise<Listing[]> {
  if (isE2eMockChain()) {
    if (typeof window !== "undefined") registerE2eMockListingsOnWindow();
    return getE2eMockListings();
  }

  // Optimized path: Use the indexer (1 RPC/HTTP call)
  try {
    const res = await fetchListings({ status: "Active" });
    if (Array.isArray(res.listings)) {
      return res.listings as Listing[];
    }
  } catch (e) {
    console.warn("[indexer] getAllListings fallback:", e);
  }

  // Backup path: On-chain scan (N RPC calls)
  const total = await getTotalListings();
  if (total <= 0) return [];
  const ids = Array.from({ length: total }, (_, i) => i + 1);
  const results = await Promise.all(
    ids.map((id) => getListing(id).catch(() => null)),
  );
  return results.filter((l): l is Listing => l !== null);
}

// ── Offer types mirrored from the Rust contract ──────────────

export type OfferStatus = "Pending" | "Accepted" | "Rejected" | "Withdrawn";

export interface Offer {
  offer_id: number;
  listing_id: number;
  offerer: string;
  amount: bigint;
  token: string;
  status: OfferStatus;
  created_at: number;
}

// ── Offer ScVal parsing ──────────────────────────────────────

function parseOfferFromScVal(raw: unknown): Offer {
  const obj = scValToNative(raw as xdr.ScVal) as Record<string, unknown>;

  return {
    offer_id: Number(obj["offer_id"]),
    listing_id: Number(obj["listing_id"]),
    offerer: (obj["offerer"] as Address).toString(),
    amount: BigInt(obj["amount"] as bigint),
    token: (obj["token"] as Address).toString(),
    status: String(obj["status"]) as OfferStatus,
    created_at: Number(obj["created_at"]),
  };
}

// ── Offer contract methods ───────────────────────────────────

export async function makeOffer(
  offererPublicKey: string,
  listingId: number,
  amountXlm: number,
  tokenAddress: string,
): Promise<number> {
  const amountStroops = xlmToStroops(amountXlm);
  const args = [
    new Address(offererPublicKey).toScVal(),
    nativeToScVal(BigInt(listingId), { type: "u64" }),
    nativeToScVal(amountStroops, { type: "i128" }),
    new Address(tokenAddress).toScVal(),
  ];
  const retVal = await invokeContract(offererPublicKey, "make_offer", args);
  return Number(scValToNative(retVal));
}

export async function withdrawOffer(
  offererPublicKey: string,
  offerId: number,
): Promise<boolean> {
  const args = [
    new Address(offererPublicKey).toScVal(),
    nativeToScVal(BigInt(offerId), { type: "u64" }),
  ];
  await invokeContract(offererPublicKey, "withdraw_offer", args);
  return true;
}

export async function acceptOffer(
  ownerPublicKey: string,
  offerId: number,
): Promise<boolean> {
  const args = [
    new Address(ownerPublicKey).toScVal(),
    nativeToScVal(BigInt(offerId), { type: "u64" }),
  ];
  await invokeContract(ownerPublicKey, "accept_offer", args);
  return true;
}

export async function rejectOffer(
  ownerPublicKey: string,
  offerId: number,
): Promise<boolean> {
  const args = [
    new Address(ownerPublicKey).toScVal(),
    nativeToScVal(BigInt(offerId), { type: "u64" }),
  ];
  await invokeContract(ownerPublicKey, "reject_offer", args);
  return true;
}

export async function getOffer(offerId: number): Promise<Offer> {
  const callerPublicKey = await getReadOnlyCallerPublicKey();
  const args = [nativeToScVal(BigInt(offerId), { type: "u64" })];
  const retVal = await invokeContract(callerPublicKey, "get_offer", args, true);
  return parseOfferFromScVal(retVal);
}

export async function getListingOffers(listingId: number): Promise<number[]> {
  const callerPublicKey = await getReadOnlyCallerPublicKey();
  const args = [nativeToScVal(BigInt(listingId), { type: "u64" })];
  const retVal = await invokeContract(
    callerPublicKey,
    "get_listing_offers",
    args,
    true,
  );
  const ids = scValToNative(retVal) as bigint[];
  return ids.map(Number);
}

export async function getOffererOffers(
  offererPublicKey: string,
): Promise<number[]> {
  const callerPublicKey = await getReadOnlyCallerPublicKey();
  const args = [new Address(offererPublicKey).toScVal()];
  const retVal = await invokeContract(
    callerPublicKey,
    "get_offerer_offers",
    args,
    true,
  );
  const ids = scValToNative(retVal) as bigint[];
  return ids.map(Number);
}

// ── Auction contract methods ──────────────────────────────────

/**
 * create_auction — Artist creates a new on-chain auction.
 *
 * @param creatorPublicKey   Stellar public key of the creator (must match Freighter)
 * @param metadataCid        IPFS CID string of the metadata JSON
 * @param reservePriceXlm    Reserve price in XLM (will be converted to stroops)
 * @param durationSeconds    Auction duration in seconds
 * @returns                  The new auction_id (number)
 */
export async function createAuction(
  creatorPublicKey: string,
  metadataCid: string,
  reservePriceXlm: number,
  durationSeconds: number,
  royaltyBps: number = 0,
  recipients: Array<{ address: string; percentage: number }> = [],
  tokenAddress: string = DEFAULT_TOKEN.address,
): Promise<number> {
  const reserveStroops = xlmToStroops(reservePriceXlm);
  const selectedToken = resolveConfiguredToken(tokenAddress);

  const finalRecipients =
    recipients.length > 0
      ? recipients
      : [{ address: creatorPublicKey, percentage: 100 }];

  const args: xdr.ScVal[] = [
    new Address(creatorPublicKey).toScVal(),
    nativeToScVal(Buffer.from(metadataCid, "utf-8"), { type: "bytes" }),
    new Address(selectedToken.address).toScVal(),
    nativeToScVal(reserveStroops, { type: "i128" }),
    nativeToScVal(BigInt(durationSeconds), { type: "u64" }),
    nativeToScVal(royaltyBps, { type: "u32" }),
    nativeToScVal(
      finalRecipients.map((r) => ({
        address: new Address(r.address),
        percentage: r.percentage,
      })),
      { type: "vec" },
    ),
  ];

  const retVal = await invokeContract(creatorPublicKey, "create_auction", args);
  return Number(scValToNative(retVal));
}

/**
 * place_bid — Bidder places a bid on an active auction.
 */
export async function placeBid(
  bidderPublicKey: string,
  auctionId: number,
  amountXlm: number,
): Promise<boolean> {
  if (isE2eMockChain()) {
    if (typeof window !== "undefined") registerE2eMockListingsOnWindow();
    return e2eMockPlaceBid(bidderPublicKey, auctionId, amountXlm);
  }

  const amountStroops = xlmToStroops(amountXlm);

  const args: xdr.ScVal[] = [
    new Address(bidderPublicKey).toScVal(),
    nativeToScVal(BigInt(auctionId), { type: "u64" }),
    nativeToScVal(amountStroops, { type: "i128" }),
  ];

  await invokeContract(bidderPublicKey, "place_bid", args);
  return true;
}

/**
 * finalize_auction — Finalize an expired or creator-cancelled auction.
 */
export async function finalizeAuction(
  callerPublicKey: string,
  auctionId: number,
): Promise<boolean> {
  if (isE2eMockChain()) {
    if (typeof window !== "undefined") registerE2eMockListingsOnWindow();
    return e2eMockFinalizeAuction(callerPublicKey, auctionId);
  }

  const args: xdr.ScVal[] = [
    new Address(callerPublicKey).toScVal(),
    nativeToScVal(BigInt(auctionId), { type: "u64" }),
  ];

  await invokeContract(callerPublicKey, "finalize_auction", args);
  return true;
}

/**
 * get_auction — Fetch a single auction by ID (read-only).
 */
export async function getAuction(auctionId: number): Promise<Auction> {
  if (isE2eMockChain()) {
    if (typeof window !== "undefined") registerE2eMockListingsOnWindow();
    return getE2eMockAuction(auctionId);
  }

  const callerPublicKey = await getReadOnlyCallerPublicKey();

  const args: xdr.ScVal[] = [nativeToScVal(BigInt(auctionId), { type: "u64" })];

  const retVal = await invokeContract(
    callerPublicKey,
    "get_auction",
    args,
    true,
  );
  return parseAuctionFromScVal(retVal);
}

/**
 * get_artist_auctions — Fetch all auction IDs for an artist.
 */
export async function getArtistAuctions(
  artistPublicKey: string,
): Promise<number[]> {
  const callerPublicKey = await getReadOnlyCallerPublicKey();

  const args: xdr.ScVal[] = [new Address(artistPublicKey).toScVal()];

  const retVal = await invokeContract(
    callerPublicKey,
    "get_artist_auctions",
    args,
    true,
  );

  const ids = scValToNative(retVal) as bigint[];
  return ids.map(Number);
}

/**
 * getAllAuctions — Fetch auctions using indexer if possible, fallback to on-chain scan.
 */
export async function getAllAuctions(): Promise<Auction[]> {
  // Optimized path: Use the indexer (1 RPC/HTTP call)
  try {
    const raw = await fetchAuctions({ status: "Active" });
    if (raw && raw.length > 0) {
      return raw as Auction[];
    }
  } catch (e) {
    console.warn("[indexer] getAllAuctions fallback:", e);
  }

  // Backup path: On-chain scan (Probing loop)
  // get_total_auctions — Read the total auction count.
  const totalRaw = await getTotalAuctions();
  const total = Math.min(totalRaw, 1000); // Safety limit
  if (total <= 0) return [];

  const auctions: Auction[] = [];
  const BATCH_SIZE = 10;

  for (let offset = 1; offset <= total; offset += BATCH_SIZE) {
    const batchIds = Array.from(
      { length: Math.min(BATCH_SIZE, total - offset + 1) },
      (_, i) => offset + i,
    );

    const results = await Promise.all(
      batchIds.map((id) => getAuction(id).catch(() => null)),
    );

    auctions.push(...results.filter((a): a is Auction => a !== null));
  }

  return auctions;
}

/**
 * get_total_auctions — Read the total auction count.
 */
export async function getTotalAuctions(): Promise<number> {
  const callerPublicKey = await getReadOnlyCallerPublicKey();
  const retVal = await invokeContract(
    callerPublicKey,
    "get_total_auctions",
    [],
    true,
  );
  return Number(scValToNative(retVal));
}

// ── Utils ───────────────────────────────────────────────────

/**
 * Converts an XLM amount (JS number) to stroops (bigint) using
 * string-based arithmetic to avoid floating-point precision loss.
 *
 * e.g. BigInt(Math.round(0.0000001 * 10_000_000)) === 0n  ← WRONG
 *      xlmToStroops(0.0000001)                          === 1n  ← CORRECT
 */
export function xlmToStroops(xlm: number): bigint {
  const isNegative = xlm < 0;
  const abs = Math.abs(xlm);
  // toFixed(7) gives the correct 7-decimal string without FP drift
  const [whole, frac = ""] = abs.toFixed(7).split(".");
  const fracPadded = frac.padEnd(7, "0").slice(0, 7);
  const result = BigInt(whole) * 10_000_000n + BigInt(fracPadded);
  return isNegative ? -result : result;
}

/** Convert stroops (i128 bigint) to XLM display string */
export function stroopsToXlm(stroops: bigint): string {
  const whole = stroops / 10_000_000n;
  const frac = stroops % 10_000_000n;

  // Convert components to absolute values for formatting
  const absWhole = whole < 0n ? -whole : whole;
  const absFrac = frac < 0n ? -frac : frac;
  const sign = whole < 0n || frac < 0n ? "-" : "";

  let fracStr = absFrac.toString().padStart(7, "0").replace(/0+$/, "");
  return fracStr ? `${sign}${absWhole}.${fracStr}` : `${sign}${absWhole}`;
}

/**
 * revoke_artist — Admin revokes an artist.
 */
export async function revokeArtist(
  adminPublicKey: string,
  artistPublicKey: string,
): Promise<boolean> {
  const args: xdr.ScVal[] = [new Address(artistPublicKey).toScVal()];

  await invokeContract(adminPublicKey, "revoke_artist", args);
  return true;
}

/**
 * reinstate_artist — Admin reinstates a revoked artist.
 */
export async function reinstateArtist(
  adminPublicKey: string,
  artistPublicKey: string,
): Promise<boolean> {
  const args: xdr.ScVal[] = [new Address(artistPublicKey).toScVal()];

  await invokeContract(adminPublicKey, "reinstate_artist", args);
  return true;
}

/**
 * is_artist_revoked — Check if an artist is revoked.
 */
export async function isArtistRevoked(
  artistPublicKey: string,
): Promise<boolean> {
  const callerPublicKey = await getReadOnlyCallerPublicKey();
  const args: xdr.ScVal[] = [new Address(artistPublicKey).toScVal()];

  try {
    const retVal = await invokeContract(
      callerPublicKey,
      "is_artist_revoked",
      args,
      true,
    );
    return scValToNative(retVal) as boolean;
  } catch {
    return false;
  }
}

/**
 * add_token_to_whitelist — Admin whitelists a token.
 */
export async function addTokenToWhitelist(
  adminPublicKey: string,
  tokenAddress: string,
): Promise<boolean> {
  const args: xdr.ScVal[] = [new Address(tokenAddress).toScVal()];

  await invokeContract(adminPublicKey, "add_token_to_whitelist", args);
  return true;
}

/**
 * remove_token_from_whitelist — Admin removes a token from whitelist.
 */
export async function removeTokenFromWhitelist(
  adminPublicKey: string,
  tokenAddress: string,
): Promise<boolean> {
  const args: xdr.ScVal[] = [new Address(tokenAddress).toScVal()];

  await invokeContract(adminPublicKey, "remove_token_from_whitelist", args);
  return true;
}

/**
 * get_token_whitelist — Fetch all whitelisted tokens.
 */
export async function getTokenWhitelist(): Promise<string[]> {
  const callerPublicKey = await getReadOnlyCallerPublicKey();
  try {
    const retVal = await invokeContract(
      callerPublicKey,
      "get_token_whitelist",
      [],
      true,
    );
    const native = scValToNative(retVal) as Address[];
    return native.map((a) => a.toString());
  } catch {
    return [];
  }
}

/**
 * get_treasury — Fetch current treasury address.
 */
export async function getTreasury(): Promise<string | null> {
  const callerPublicKey = await getReadOnlyCallerPublicKey();
  try {
    const retVal = await invokeContract(
      callerPublicKey,
      "get_treasury",
      [],
      true,
    );
    const native = scValToNative(retVal);
    return native ? (native as Address).toString() : null;
  } catch {
    return null;
  }
}

/**
 * get_protocol_fee — Fetch current protocol fee (bps).
 */
export async function getProtocolFee(): Promise<number> {
  const callerPublicKey = await getReadOnlyCallerPublicKey();
  try {
    const retVal = await invokeContract(
      callerPublicKey,
      "get_protocol_fee",
      [],
      true,
    );
    return Number(scValToNative(retVal));
  } catch {
    return 0;
  }
}

/**
 * get_admin — Fetch current admin address.
 */
export async function getAdmin(): Promise<string | null> {
  const callerPublicKey = await getReadOnlyCallerPublicKey();
  try {
    const retVal = await invokeContract(callerPublicKey, "get_admin", [], true);
    // get_admin returns Option<Address>
    const native = scValToNative(retVal);
    if (!native) return null;
    return (native as Address).toString();
  } catch {
    return null;
  }
}
