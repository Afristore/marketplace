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
import { signWithFreighter } from "./freighter";

// ── Types mirrored from the Rust contract ────────────────────

export type ListingStatus = "Active" | "Sold" | "Cancelled";

export interface Recipient {
  address: string;
  percentage: number;
}

export interface Listing {
  listing_id: number;
  artist: string;
  metadata_cid: string;
  price: bigint;
  currency: string;
  token: string;
  recipients: Recipient[];
  status: ListingStatus;
  owner: string | null;
  created_at: number;
  original_creator: string;
  royalty_bps: number;
}

export type AuctionStatus = "Active" | "Finalized" | "Cancelled";

export interface Auction {
  auction_id: number;
  creator: string;
  metadata_cid: string;
  token: string;
  reserve_price: bigint;
  highest_bid: bigint;
  highest_bidder: string | null;
  end_time: number;
  status: AuctionStatus;
  recipients: Recipient[];
  royalty_bps: number;
  original_creator: string;
}

// ── Soroban RPC server ────────────────────────────────────────

function getRpc(): SorobanRpc.Server {
  return new SorobanRpc.Server(config.rpcUrl, { allowHttp: false });
}

function getContract(): Contract {
  return new Contract(config.contractId);
}

function getNetworkPassphrase(): string {
  return config.networkPassphrase;
}

// ── Invoke helper ─────────────────────────────────────────────

/**
 * Builds, simulates, signs (via Freighter), and submits a contract
 * invocation transaction. Returns the simulation result for read-only
 * calls, or the ledger result for state-changing calls.
 */
async function invokeContract(
  callerPublicKey: string,
  method: string,
  args: xdr.ScVal[],
  readonly = false
): Promise<xdr.ScVal> {
  const rpc = getRpc();
  const contract = getContract();

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
    throw new Error(`Simulation failed: ${simResult.error}`);
  }

  if (readonly) {
    // For read-only calls return the simulated result directly.
    const retVal = (simResult as SorobanRpc.Api.SimulateTransactionSuccessResponse)
      .result?.retval;
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
    TransactionBuilder.fromXDR(signedXdr, getNetworkPassphrase())
  );

  if (submitted.status === "ERROR") {
    throw new Error(`Transaction submission failed: ${submitted.errorResult}`);
  }

  // Poll for completion.
  let getResult = await rpc.getTransaction(submitted.hash);
  while (
    getResult.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND
  ) {
    await new Promise((r) => setTimeout(r, 1000));
    getResult = await rpc.getTransaction(submitted.hash);
  }

  if (getResult.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
    throw new Error("Transaction failed on-chain.");
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
    metadata_cid: Buffer.from(obj["metadata_cid"] as Uint8Array).toString("utf-8"),
    price: BigInt(obj["price"] as bigint),
    currency: String(obj["currency"]),
    token: (obj["token"] as Address).toString(),
    recipients: (obj["recipients"] as any[]).map(parseRecipient),
    status: String(obj["status"]) as ListingStatus,
    owner: obj["owner"] ? (obj["owner"] as Address).toString() : null,
    created_at: Number(obj["created_at"]),
    original_creator: (obj["original_creator"] as Address).toString(),
    royalty_bps: Number(obj["royalty_bps"]),
  };
}

function parseAuctionFromScVal(raw: unknown): Auction {
  const obj = scValToNative(raw as xdr.ScVal) as Record<string, unknown>;

  return {
    auction_id: Number(obj["auction_id"]),
    creator: (obj["creator"] as Address).toString(),
    metadata_cid: Buffer.from(obj["metadata_cid"] as Uint8Array).toString("utf-8"),
    token: (obj["token"] as Address).toString(),
    reserve_price: BigInt(obj["reserve_price"] as bigint),
    highest_bid: BigInt(obj["highest_bid"] as bigint),
    highest_bidder: obj["highest_bidder"] ? (obj["highest_bidder"] as Address).toString() : null,
    end_time: Number(obj["end_time"]),
    status: String(obj["status"]) as AuctionStatus,
    recipients: (obj["recipients"] as any[]).map(parseRecipient),
    royalty_bps: Number(obj["royalty_bps"]),
    original_creator: (obj["original_creator"] as Address).toString(),
  };
}

// ── Listing contract methods ──────────────────────────────────

/**
 * create_listing — Artist creates a new on-chain listing.
 */
export async function createListing(
  artistPublicKey: string,
  metadataCid: string,
  price: number,
  tokenAddress: string = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC", // Default to XLM
  royaltyBps: number = 0,
  recipients: Array<{ address: string; percentage: number }> = []
): Promise<number> {
  const priceStroops = BigInt(Math.round(price * 10_000_000));

  // If no recipients provided, default to 100% to the artist
  const finalRecipients = recipients.length > 0 
    ? recipients 
    : [{ address: artistPublicKey, percentage: 100 }];

  const args: xdr.ScVal[] = [
    new Address(artistPublicKey).toScVal(),
    nativeToScVal(Buffer.from(metadataCid, "utf-8"), { type: "bytes" }),
    nativeToScVal(priceStroops, { type: "i128" }),
    nativeToScVal("XLM", { type: "symbol" }),
    new Address(tokenAddress).toScVal(),
    nativeToScVal(royaltyBps, { type: "u32" }),
    nativeToScVal(finalRecipients.map(r => ({
        address: new Address(r.address),
        percentage: r.percentage
    })), { type: "vec" }),
  ];

  const retVal = await invokeContract(artistPublicKey, "create_listing", args);
  return Number(scValToNative(retVal));
}

/**
 * buy_artwork — Buyer purchases a listed artwork.
 */
export async function buyArtwork(
  buyerPublicKey: string,
  listingId: number
): Promise<boolean> {
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
  listingId: number
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
  newRecipients: Array<{ address: string; percentage: number }> = []
): Promise<boolean> {
  const priceStroops = BigInt(Math.round(newPrice * 10_000_000));

  const args: xdr.ScVal[] = [
    new Address(artistPublicKey).toScVal(),
    nativeToScVal(BigInt(listingId), { type: "u64" }),
    nativeToScVal(Buffer.from(newMetadataCid, "utf-8"), { type: "bytes" }),
    nativeToScVal(priceStroops, { type: "i128" }),
    new Address(newTokenAddress).toScVal(),
    nativeToScVal(newRecipients.map(r => ({
        address: new Address(r.address),
        percentage: r.percentage
    })), { type: "vec" }),
  ];

  await invokeContract(artistPublicKey, "update_listing", args);
  return true;
}

/**
 * get_listing — Fetch a single listing by ID.
 */
export async function getListing(listingId: number): Promise<Listing> {
  const DUMMY_KEY = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
  const args = [nativeToScVal(BigInt(listingId), { type: "u64" })];
  const retVal = await invokeContract(DUMMY_KEY, "get_listing", args, true);
  return parseListingFromScVal(retVal);
}

/**
 * get_total_listings — Read the total listing count.
 */
export async function getTotalListings(): Promise<number> {
  const DUMMY_KEY = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
  const retVal = await invokeContract(DUMMY_KEY, "get_total_listings", [], true);
  return Number(scValToNative(retVal));
}

/**
 * get_artist_listings — Fetch all listing IDs for an artist.
 */
export async function getArtistListings(artistPublicKey: string): Promise<number[]> {
  const DUMMY_KEY = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
  const args = [new Address(artistPublicKey).toScVal()];
  const retVal = await invokeContract(DUMMY_KEY, "get_artist_listings", args, true);
  const ids = scValToNative(retVal) as bigint[];
  return ids.map(Number);
}

/**
 * getAllListings — Fetch every listing from ID 1 → total.
 */
export async function getAllListings(): Promise<Listing[]> {
  const total = await getTotalListings();
  const listings: Listing[] = [];
  for (let i = 1; i <= total; i++) {
    try {
      const l = await getListing(i);
      listings.push(l);
    } catch {
      // Skip deleted / archived entries.
    }
  }
  return listings;
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
  amountXlm: number
): Promise<number> {
  const amountStroops = BigInt(Math.round(amountXlm * 10_000_000));
  const args = [
    new Address(offererPublicKey).toScVal(),
    nativeToScVal(BigInt(listingId), { type: "u64" }),
    nativeToScVal(amountStroops, { type: "i128" }),
    nativeToScVal("XLM", { type: "symbol" }),
  ];
  const retVal = await invokeContract(offererPublicKey, "make_offer", args);
  return Number(scValToNative(retVal));
}

export async function withdrawOffer(offererPublicKey: string, offerId: number): Promise<boolean> {
  const args = [new Address(offererPublicKey).toScVal(), nativeToScVal(BigInt(offerId), { type: "u64" })];
  await invokeContract(offererPublicKey, "withdraw_offer", args);
  return true;
}

export async function acceptOffer(ownerPublicKey: string, offerId: number): Promise<boolean> {
  const args = [new Address(ownerPublicKey).toScVal(), nativeToScVal(BigInt(offerId), { type: "u64" })];
  await invokeContract(ownerPublicKey, "accept_offer", args);
  return true;
}

export async function rejectOffer(ownerPublicKey: string, offerId: number): Promise<boolean> {
  const args = [new Address(ownerPublicKey).toScVal(), nativeToScVal(BigInt(offerId), { type: "u64" })];
  await invokeContract(ownerPublicKey, "reject_offer", args);
  return true;
}

export async function getOffer(offerId: number): Promise<Offer> {
  const DUMMY_KEY = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
  const args = [nativeToScVal(BigInt(offerId), { type: "u64" })];
  const retVal = await invokeContract(DUMMY_KEY, "get_offer", args, true);
  return parseOfferFromScVal(retVal);
}

export async function getListingOffers(listingId: number): Promise<number[]> {
  const DUMMY_KEY = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
  const args = [nativeToScVal(BigInt(listingId), { type: "u64" })];
  const retVal = await invokeContract(DUMMY_KEY, "get_listing_offers", args, true);
  const ids = scValToNative(retVal) as bigint[];
  return ids.map(Number);
}

export async function getOffererOffers(offererPublicKey: string): Promise<number[]> {
  const DUMMY_KEY = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
  const args = [new Address(offererPublicKey).toScVal()];
  const retVal = await invokeContract(DUMMY_KEY, "get_offerer_offers", args, true);
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
  durationSeconds: number
): Promise<number> {
  const reserveStroops = BigInt(Math.round(reservePriceXlm * 10_000_000));

  const args: xdr.ScVal[] = [
    // creator: Address
    new Address(creatorPublicKey).toScVal(),
    // metadata_cid: Bytes
    nativeToScVal(Buffer.from(metadataCid, "utf-8"), { type: "bytes" }),
    // token: Address (native XLM contract)
    new Address("CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC").toScVal(),
    // reserve_price: i128
    nativeToScVal(reserveStroops, { type: "i128" }),
    // duration: u64
    nativeToScVal(BigInt(durationSeconds), { type: "u64" }),
    // royalty_bps: u32
    nativeToScVal(0, { type: "u32" }),
    // recipients: Vec<Recipient> (empty for MVP)
    nativeToScVal([], { type: "vec" }),
  ];

  const retVal = await invokeContract(
    creatorPublicKey,
    "create_auction",
    args
  );
  return Number(scValToNative(retVal));
}

/**
 * place_bid — Bidder places a bid on an active auction.
 */
export async function placeBid(
  bidderPublicKey: string,
  auctionId: number,
  amountXlm: number
): Promise<boolean> {
  const amountStroops = BigInt(Math.round(amountXlm * 10_000_000));

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
  auctionId: number
): Promise<boolean> {
  const args: xdr.ScVal[] = [
    nativeToScVal(BigInt(auctionId), { type: "u64" }),
  ];

  await invokeContract(callerPublicKey, "finalize_auction", args);
  return true;
}

/**
 * get_auction — Fetch a single auction by ID (read-only).
 */
export async function getAuction(auctionId: number): Promise<Auction> {
  const DUMMY_KEY = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

  const args: xdr.ScVal[] = [
    nativeToScVal(BigInt(auctionId), { type: "u64" }),
  ];

  const retVal = await invokeContract(DUMMY_KEY, "get_auction", args, true);
  return parseAuctionFromScVal(retVal);
}

/**
 * get_artist_auctions — Fetch all auction IDs for an artist.
 */
export async function getArtistAuctions(
  artistPublicKey: string
): Promise<number[]> {
  const DUMMY_KEY = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

  const args: xdr.ScVal[] = [new Address(artistPublicKey).toScVal()];

  const retVal = await invokeContract(
    DUMMY_KEY,
    "get_artist_auctions",
    args,
    true
  );

  const ids = scValToNative(retVal) as bigint[];
  return ids.map(Number);
}

/**
 * getAllAuctions — Convenience: fetch every auction by trying IDs
 * sequentially from 1 until a fetch fails.
 */
export async function getAllAuctions(): Promise<Auction[]> {
  const auctions: Auction[] = [];
  let consecutiveFailures = 0;

  for (let i = 1; consecutiveFailures < 3; i++) {
    try {
      const a = await getAuction(i);
      auctions.push(a);
      consecutiveFailures = 0;
    } catch {
      consecutiveFailures++;
    }
  }

  return auctions;
}

// ── Utils ───────────────────────────────────────────────────

export function stroopsToXlm(stroops: bigint): string {
  const xlm = Number(stroops) / 10_000_000;
  return xlm.toFixed(7).replace(/\.?0+$/, "");
}
