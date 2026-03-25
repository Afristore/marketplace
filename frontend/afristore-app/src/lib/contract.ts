// ─────────────────────────────────────────────────────────────
// lib/contract.ts — Soroban Marketplace contract client
//
// All blockchain interaction flows through this module.
// It builds transactions, simulates them, and submits via
// Stellar SDK + Freighter signing.
// ─────────────────────────────────────────────────────────────

import {
  Contract,
  Networks,
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

export interface Listing {
  listing_id: number;
  artist: string;
  metadata_cid: string;
  price: bigint;
  currency: string;
  status: ListingStatus;
  owner: string | null;
  created_at: number;
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

function parseListingFromScVal(raw: unknown): Listing {
  // scValToNative converts the Soroban map/struct to a plain JS object.
  const obj = scValToNative(raw as xdr.ScVal) as Record<string, unknown>;

  return {
    listing_id: Number(obj["listing_id"]),
    artist: (obj["artist"] as Address).toString(),
    metadata_cid: Buffer.from(obj["metadata_cid"] as Uint8Array).toString(
      "utf-8"
    ),
    price: BigInt(obj["price"] as bigint),
    currency: String(obj["currency"]),
    status: String(obj["status"]) as ListingStatus,
    owner: obj["owner"] ? (obj["owner"] as Address).toString() : null,
    created_at: Number(obj["created_at"]),
  };
}

// ── Contract methods ──────────────────────────────────────────

/**
 * create_listing — Artist creates a new on-chain listing.
 *
 * @param artistPublicKey  Stellar public key of the artist (must match Freighter)
 * @param metadataCid      IPFS CID string of the metadata JSON
 * @param priceXlm         Price in XLM (will be converted to stroops)
 * @param token            Token symbol (e.g., "XLM", "USDC")
 * @returns                The new listing_id (number)
 */
export async function createListing(
  artistPublicKey: string,
  metadataCid: string,
  priceXlm: number,
  token: string = "XLM"
): Promise<number> {
  const priceStroops = BigInt(Math.round(priceXlm * 10_000_000));

  const args: xdr.ScVal[] = [
    // artist: Address
    new Address(artistPublicKey).toScVal(),
    // metadata_cid: Bytes
    nativeToScVal(Buffer.from(metadataCid, "utf-8"), { type: "bytes" }),
    // price: i128
    nativeToScVal(priceStroops, { type: "i128" }),
    // currency: Symbol
    nativeToScVal(token, { type: "symbol" }),
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
 * get_listing — Fetch a single listing by ID (read-only, no Freighter needed).
 */
export async function getListing(listingId: number): Promise<Listing> {
  // Use a dummy source account for read-only simulation.
  const DUMMY_KEY = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

  const args: xdr.ScVal[] = [
    nativeToScVal(BigInt(listingId), { type: "u64" }),
  ];

  const retVal = await invokeContract(DUMMY_KEY, "get_listing", args, true);
  return parseListingFromScVal(retVal);
}

/**
 * get_total_listings — Read the total listing count.
 */
export async function getTotalListings(): Promise<number> {
  const DUMMY_KEY = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

  const retVal = await invokeContract(
    DUMMY_KEY,
    "get_total_listings",
    [],
    true
  );
  return Number(scValToNative(retVal));
}

/**
 * get_artist_listings — Fetch all listing IDs for an artist.
 */
export async function getArtistListings(
  artistPublicKey: string
): Promise<number[]> {
  const DUMMY_KEY = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

  const args: xdr.ScVal[] = [new Address(artistPublicKey).toScVal()];

  const retVal = await invokeContract(
    DUMMY_KEY,
    "get_artist_listings",
    args,
    true
  );

  const ids = scValToNative(retVal) as bigint[];
  return ids.map(Number);
}

/**
 * getAllListings — Convenience: fetch every listing from ID 1 → total.
 * Batches reads sequentially (suitable for MVP scale).
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

/** Convert stroops (i128 bigint) to XLM display string */
export function stroopsToXlm(stroops: bigint): string {
  const xlm = Number(stroops) / 10_000_000;
  return xlm.toFixed(7).replace(/\.?0+$/, "");
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
    token: String(obj["token"]),
    status: String(obj["status"]) as OfferStatus,
    created_at: Number(obj["created_at"]),
  };
}

// ── Offer contract methods ───────────────────────────────────

/**
 * make_offer — Places an offer on a listing.
 *
 * @param offererPublicKey  Stellar public key of the offerer (must match Freighter)
 * @param listingId         The listing to place an offer on
 * @param amountXlm         Offer amount in XLM (will be converted to stroops)
 * @returns                 The new offer_id (number)
 */
export async function makeOffer(
  offererPublicKey: string,
  listingId: number,
  amountXlm: number
): Promise<number> {
  const amountStroops = BigInt(Math.round(amountXlm * 10_000_000));

  const args: xdr.ScVal[] = [
    new Address(offererPublicKey).toScVal(),
    nativeToScVal(BigInt(listingId), { type: "u64" }),
    nativeToScVal(amountStroops, { type: "i128" }),
    nativeToScVal("XLM", { type: "symbol" }),
  ];

  const retVal = await invokeContract(offererPublicKey, "make_offer", args);
  return Number(scValToNative(retVal));
}

/**
 * withdraw_offer — Offerer withdraws their pending offer.
 */
export async function withdrawOffer(
  offererPublicKey: string,
  offerId: number
): Promise<boolean> {
  const args: xdr.ScVal[] = [
    new Address(offererPublicKey).toScVal(),
    nativeToScVal(BigInt(offerId), { type: "u64" }),
  ];

  await invokeContract(offererPublicKey, "withdraw_offer", args);
  return true;
}

/**
 * accept_offer — Listing owner accepts an offer.
 */
export async function acceptOffer(
  ownerPublicKey: string,
  offerId: number
): Promise<boolean> {
  const args: xdr.ScVal[] = [
    new Address(ownerPublicKey).toScVal(),
    nativeToScVal(BigInt(offerId), { type: "u64" }),
  ];

  await invokeContract(ownerPublicKey, "accept_offer", args);
  return true;
}

/**
 * reject_offer — Listing owner rejects an offer.
 */
export async function rejectOffer(
  ownerPublicKey: string,
  offerId: number
): Promise<boolean> {
  const args: xdr.ScVal[] = [
    new Address(ownerPublicKey).toScVal(),
    nativeToScVal(BigInt(offerId), { type: "u64" }),
  ];

  await invokeContract(ownerPublicKey, "reject_offer", args);
  return true;
}

/**
 * get_offer — Fetch a single offer by ID (read-only, no Freighter needed).
 */
export async function getOffer(offerId: number): Promise<Offer> {
  const DUMMY_KEY = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

  const args: xdr.ScVal[] = [
    nativeToScVal(BigInt(offerId), { type: "u64" }),
  ];

  const retVal = await invokeContract(DUMMY_KEY, "get_offer", args, true);
  return parseOfferFromScVal(retVal);
}

/**
 * get_listing_offers — Fetch all offer IDs for a listing (read-only).
 */
export async function getListingOffers(listingId: number): Promise<number[]> {
  const DUMMY_KEY = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

  const args: xdr.ScVal[] = [
    nativeToScVal(BigInt(listingId), { type: "u64" }),
  ];

  const retVal = await invokeContract(
    DUMMY_KEY,
    "get_listing_offers",
    args,
    true
  );

  const ids = scValToNative(retVal) as bigint[];
  return ids.map(Number);
}

/**
 * get_offerer_offers — Fetch all offer IDs placed by an offerer (read-only).
 */
export async function getOffererOffers(
  offererPublicKey: string
): Promise<number[]> {
  const DUMMY_KEY = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

  const args: xdr.ScVal[] = [new Address(offererPublicKey).toScVal()];

  const retVal = await invokeContract(
    DUMMY_KEY,
    "get_offerer_offers",
    args,
    true
  );

  const ids = scValToNative(retVal) as bigint[];
  return ids.map(Number);
}
