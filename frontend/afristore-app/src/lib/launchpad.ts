import {
  Address,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import { config } from "./config";
import { invokeContract } from "./contract";

// ── Types ─────────────────────────────────────────────────────

export type CollectionKind =
  | "Normal721"
  | "Normal1155"
  | "LazyMint721"
  | "LazyMint1155";

export interface CollectionRecord {
  address: string;
  kind: CollectionKind;
  creator: string;
}

export interface PlatformFee {
  receiver: string;
  bps: number;
}

// ── Parsing ───────────────────────────────────────────────────

function parseCollectionRecord(raw: any): CollectionRecord {
  // raw is from scValToNative
  return {
    address: (raw.address as Address).toString(),
    kind: String(raw.kind) as CollectionKind,
    creator: (raw.creator as Address).toString(),
  };
}

function toAddressScVal(address: string): xdr.ScVal {
  return new Address(address).toScVal();
}

// ── Launchpad Methods ─────────────────────────────────────────

/**
 * deploy_normal_721
 */
export async function deployNormal721(
  creatorPublicKey: string,
  name: string,
  symbol: string,
  maxSupply: number,
  royaltyBps: number,
  royaltyReceiver: string,
  salt: Buffer, // 32 bytes
): Promise<string> {
  const args: xdr.ScVal[] = [
    toAddressScVal(creatorPublicKey),
    nativeToScVal(name, { type: "string" }),
    nativeToScVal(symbol, { type: "string" }),
    nativeToScVal(BigInt(maxSupply), { type: "u64" }),
    nativeToScVal(royaltyBps, { type: "u32" }),
    toAddressScVal(royaltyReceiver),
    nativeToScVal(Uint8Array.from(salt), { type: "bytes" }),
  ];

  const retVal = await invokeContract(
    creatorPublicKey,
    "deploy_normal_721",
    args,
    false,
    config.launchpadContractId,
  );
  return (scValToNative(retVal) as Address).toString();
}

/**
 * deploy_normal_1155
 */
export async function deployNormal1155(
  creatorPublicKey: string,
  name: string,
  royaltyBps: number,
  royaltyReceiver: string,
  salt: Buffer,
): Promise<string> {
  const args: xdr.ScVal[] = [
    toAddressScVal(creatorPublicKey),
    nativeToScVal(name, { type: "string" }),
    nativeToScVal(royaltyBps, { type: "u32" }),
    toAddressScVal(royaltyReceiver),
    nativeToScVal(Uint8Array.from(salt), { type: "bytes" }),
  ];

  const retVal = await invokeContract(
    creatorPublicKey,
    "deploy_normal_1155",
    args,
    false,
    config.launchpadContractId,
  );
  return (scValToNative(retVal) as Address).toString();
}

/**
 * deploy_lazy_721
 */
export async function deployLazy721(
  creatorPublicKey: string,
  creatorPubkeyBytes: Buffer, // 32 bytes
  name: string,
  symbol: string,
  maxSupply: number,
  royaltyBps: number,
  royaltyReceiver: string,
  salt: Buffer,
): Promise<string> {
  const args: xdr.ScVal[] = [
    toAddressScVal(creatorPublicKey),
    nativeToScVal(Uint8Array.from(creatorPubkeyBytes), { type: "bytes" }),
    nativeToScVal(name, { type: "string" }),
    nativeToScVal(symbol, { type: "string" }),
    nativeToScVal(BigInt(maxSupply), { type: "u64" }),
    nativeToScVal(royaltyBps, { type: "u32" }),
    toAddressScVal(royaltyReceiver),
    nativeToScVal(Uint8Array.from(salt), { type: "bytes" }),
  ];

  const retVal = await invokeContract(
    creatorPublicKey,
    "deploy_lazy_721",
    args,
    false,
    config.launchpadContractId,
  );
  return (scValToNative(retVal) as Address).toString();
}

/**
 * deploy_lazy_1155
 */
export async function deployLazy1155(
  creatorPublicKey: string,
  creatorPubkeyBytes: Buffer,
  name: string,
  royaltyBps: number,
  royaltyReceiver: string,
  salt: Buffer,
): Promise<string> {
  const args: xdr.ScVal[] = [
    toAddressScVal(creatorPublicKey),
    nativeToScVal(Uint8Array.from(creatorPubkeyBytes), { type: "bytes" }),
    nativeToScVal(name, { type: "string" }),
    nativeToScVal(royaltyBps, { type: "u32" }),
    toAddressScVal(royaltyReceiver),
    nativeToScVal(Uint8Array.from(salt), { type: "bytes" }),
  ];

  const retVal = await invokeContract(
    creatorPublicKey,
    "deploy_lazy_1155",
    args,
    false,
    config.launchpadContractId,
  );
  return (scValToNative(retVal) as Address).toString();
}

/**
 * deploy_splitter - Deploy a royalty splitter contract
 */
export async function deploySplitter(
  creatorPublicKey: string,
  token: string,
  beneficiaries: string[],
  shares: number[],
  salt: Buffer,
): Promise<string> {
  const addressArray = beneficiaries.map(b => new Address(b));
  const beneficiariesScVal = nativeToScVal(addressArray, { type: "Vec" });
  const sharesScVal = nativeToScVal(shares, { type: "Vec" });

  const args: xdr.ScVal[] = [
    toAddressScVal(creatorPublicKey),
    toAddressScVal(token),
    beneficiariesScVal,
    sharesScVal,
    nativeToScVal(Uint8Array.from(salt), { type: "bytes" }),
  ];

  const retVal = await invokeContract(
    creatorPublicKey,
    "deploy_splitter",
    args,
    false,
    config.launchpadContractId,
  );
  return (scValToNative(retVal) as Address).toString();
}

/**
 * collections_by_creator
 */
export async function getCollectionsByCreator(
  creatorPublicKey: string,
): Promise<CollectionRecord[]> {
  const DUMMY_KEY = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
  const args = [toAddressScVal(creatorPublicKey)];
  const retVal = await invokeContract(
    DUMMY_KEY,
    "collections_by_creator",
    args,
    true,
    config.launchpadContractId,
  );
  const native = scValToNative(retVal) as any[];
  return native.map(parseCollectionRecord);
}

/**
 * get_collections — paginated
 */
export async function getCollections(
  startIndex: number,
  limit: number,
): Promise<CollectionRecord[]> {
  const DUMMY_KEY = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
  const args: xdr.ScVal[] = [
    nativeToScVal(startIndex, { type: "u32" }),
    nativeToScVal(limit, { type: "u32" }),
  ];
  const retVal = await invokeContract(
    DUMMY_KEY,
    "get_collections",
    args,
    true,
    config.launchpadContractId,
  );
  const native = scValToNative(retVal) as any[];
  return native.map(parseCollectionRecord);
}

export async function getCollectionRecordByAddress(
  collectionAddress: string,
): Promise<CollectionRecord | null> {
  const DUMMY_KEY = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
  const args = [toAddressScVal(collectionAddress)];
  try {
    const retVal = await invokeContract(
      DUMMY_KEY,
      "get_collection_by_id",
      args,
      true,
      config.launchpadContractId,
    );
    const native = scValToNative(retVal);
    if (!native) return null;
    return parseCollectionRecord(native);
  } catch {
    return null;
  }
}

// ── Staking pool factory ──────────────────────────────────────

/**
 * Look up the staking pool clone for an NFT collection address.
 */
export async function getStakingPoolByNft(
  nftAddress: string,
): Promise<string | null> {
  const DUMMY_KEY =
    "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
  const retVal = await invokeContract(
    DUMMY_KEY,
    "get_staking_pool",
    [toAddressScVal(nftAddress)],
    true,
    config.launchpadContractId,
  );
  const native = scValToNative(retVal);
  if (!native) return null;
  return (native as Address).toString();
}

/**
 * Deploy a dedicated NftStaking clone for an NFT collection via the Launchpad.
 */
export async function deployStakingPool(
  creatorPublicKey: string,
  nftAddress: string,
  rewardToken: string,
  rewardRate: bigint,
  salt: Buffer,
): Promise<string> {
  const args: xdr.ScVal[] = [
    toAddressScVal(creatorPublicKey),
    toAddressScVal(nftAddress),
    toAddressScVal(rewardToken),
    nativeToScVal(rewardRate, { type: "i128" }),
    nativeToScVal(Uint8Array.from(salt), { type: "bytes" }),
  ];

  const retVal = await invokeContract(
    creatorPublicKey,
    "deploy_staking_pool",
    args,
    false,
    config.launchpadContractId,
  );
  return (scValToNative(retVal) as Address).toString();
}

/**
 * collection_count
 */
export async function getCollectionCount(): Promise<number> {
  const DUMMY_KEY = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
  const retVal = await invokeContract(
    DUMMY_KEY,
    "collection_count",
    [],
    true,
    config.launchpadContractId,
  );
  return Number(scValToNative(retVal));
}

/**
 * platform_fee
 */
export async function getPlatformFee(): Promise<PlatformFee> {
  const DUMMY_KEY = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
  const retVal = await invokeContract(
    DUMMY_KEY,
    "platform_fee",
    [],
    true,
    config.launchpadContractId,
  );
  const native = scValToNative(retVal) as [Address, number];
  return {
    receiver: native[0].toString(),
    bps: Number(native[1]),
  };
}

/**
 * admin
 */
export async function getLaunchpadAdmin(): Promise<string> {
  const DUMMY_KEY = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
  const retVal = await invokeContract(
    DUMMY_KEY,
    "admin",
    [],
    true,
    config.launchpadContractId,
  );
  return (scValToNative(retVal) as Address).toString();
}

/**
 * transfer_admin
 */
export async function transferLaunchpadAdmin(
  adminPublicKey: string,
  newAdminAddress: string,
): Promise<void> {
  const args = [toAddressScVal(newAdminAddress)];
  await invokeContract(
    adminPublicKey,
    "transfer_admin",
    args,
    false,
    config.launchpadContractId,
  );
}

/**
 * update_platform_fee
 */
export async function updatePlatformFee(
  adminPublicKey: string,
  receiverAddress: string,
  feeBps: number,
): Promise<void> {
  const args = [
    toAddressScVal(receiverAddress),
    nativeToScVal(feeBps, { type: "u32" }),
  ];
  await invokeContract(
    adminPublicKey,
    "update_platform_fee",
    args,
    false,
    config.launchpadContractId,
  );
}

// ── Collection-Specific Methods ───────────────────────────────

export interface CollectionMetadata {
  name: string;
  symbol: string;
  creator: string;
  totalSupply: number;
  maxSupply: number;
  royaltyBps: number;
  royaltyReceiver: string;
}

/**
 * Fetch metadata for any deployed collection (721 or 1155).
 */
export async function getCollectionMetadata(
  collectionAddress: string,
): Promise<CollectionMetadata> {
  const DUMMY_KEY = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

  const [name, symbol, creator, totalSupply, maxSupply, royalty] =
    await Promise.all([
      invokeContract(DUMMY_KEY, "name", [], true, collectionAddress),
      invokeContract(DUMMY_KEY, "symbol", [], true, collectionAddress).catch(
        () => nativeToScVal("", { type: "string" }),
      ), // 1155 might not have symbol
      invokeContract(DUMMY_KEY, "creator", [], true, collectionAddress),
      invokeContract(DUMMY_KEY, "total_supply", [], true, collectionAddress),
      invokeContract(DUMMY_KEY, "max_supply", [], true, collectionAddress),
      invokeContract(DUMMY_KEY, "royalty_info", [], true, collectionAddress),
    ]);

  const royaltyNative = scValToNative(royalty) as [Address, number];

  return {
    name: scValToNative(name) as string,
    symbol: scValToNative(symbol) as string,
    creator: (scValToNative(creator) as Address).toString(),
    totalSupply: Number(scValToNative(totalSupply)),
    maxSupply: Number(scValToNative(maxSupply)),
    royaltyBps: Number(royaltyNative[1]),
    royaltyReceiver: royaltyNative[0].toString(),
  };
}

/**
 * deploy_lazy_721
 */
export async function deployLazy721(
  creatorPublicKey: string,
  creatorPubkeyBytes: Buffer, // 32 bytes
  name: string,
  symbol: string,
  maxSupply: number,
  royaltyBps: number,
  royaltyReceiver: string,
  salt: Buffer,
): Promise<string> {
  const args: xdr.ScVal[] = [
    toAddressScVal(creatorPublicKey),
    nativeToScVal(Uint8Array.from(creatorPubkeyBytes), { type: "bytes" }),
    nativeToScVal(name, { type: "string" }),
    nativeToScVal(symbol, { type: "string" }),
    nativeToScVal(BigInt(maxSupply), { type: "u64" }),
    nativeToScVal(royaltyBps, { type: "u32" }),
    toAddressScVal(royaltyReceiver),
    nativeToScVal(Uint8Array.from(salt), { type: "bytes" }),
  ];

  const retVal = await invokeContract(
    creatorPublicKey,
    "mint",
    args,
    false,
    collectionAddress,
  );
  return Number(scValToNative(retVal));
}

function mapKeySymbol(name: string, val: xdr.ScVal): xdr.ScMapEntry {
  return new xdr.ScMapEntry({
    key: nativeToScVal(name, { type: "symbol" }),
    val,
  });
}

/**
 * Mints a new token type in a Normal 1155 collection (creator only).
 * Wraps `mint_new(to, amount, uri)`.
 */
export async function mint1155New(
  creatorPublicKey: string,
  collectionAddress: string,
  recipient: string,
  amount: bigint,
  metadataCid: string,
): Promise<number> {
  const args: xdr.ScVal[] = [
    toAddressScVal(recipient),
    nativeToScVal(amount, { type: "u128" }),
    nativeToScVal(metadataCid, { type: "string" }),
  ];

  const retVal = await invokeContract(
    creatorPublicKey,
    "mint_new",
    args,
    false,
    collectionAddress,
  );
  return Number(scValToNative(retVal));
}

// ── Lazy mint vouchers (Soroban `MintVoucher` / `MintVoucher1155`) ─

export interface Lazy721VoucherInput {
  token_id: string;
  price: string;
  currency: string;
  uri: string;
  uri_hash: string;
  valid_until: string;
}

export interface Lazy1155VoucherInput {
  token_id: string;
  buyer_quota: string;
  price_per_unit: string;
  currency: string;
  uri: string;
  uri_hash: string;
  valid_until: string;
}

function parseHex32(label: string, hex: string): Buffer {
  const t = hex.trim();
  if (!/^[0-9a-fA-F]{64}$/.test(t)) {
    throw new Error(`${label} must be exactly 64 hex characters (32 bytes)`);
  }
  return Buffer.from(t, "hex");
}

function parseHexSignature(label: string, hex: string): Buffer {
  const t = hex.trim();
  if (!/^[0-9a-fA-F]{128}$/.test(t)) {
    throw new Error(
      `${label} must be exactly 128 hex characters (ed25519 signature)`,
    );
  }
  return Buffer.from(t, "hex");
}

function mintVoucher721ToScVal(v: Lazy721VoucherInput): xdr.ScVal {
  const tokenId = BigInt(v.token_id);
  const price = BigInt(v.price);
  const validUntil = BigInt(v.valid_until);
  const hashBuf = parseHex32("uri_hash", v.uri_hash);
  if (v.uri.length === 0) throw new Error("uri is required");
  if (!v.currency || !v.currency.startsWith("C")) {
    throw new Error(
      "currency must be a Stellar contract address (SAC), e.g. the XLM SAC",
    );
  }
  return xdr.ScVal.scvMap([
    mapKeySymbol("token_id", nativeToScVal(tokenId, { type: "u64" })),
    mapKeySymbol("price", nativeToScVal(price, { type: "i128" })),
    mapKeySymbol("currency", toAddressScVal(v.currency)),
    mapKeySymbol("uri", nativeToScVal(v.uri, { type: "string" })),
    mapKeySymbol(
      "uri_hash",
      nativeToScVal(Uint8Array.from(hashBuf), { type: "bytes" }),
    ),
    mapKeySymbol("valid_until", nativeToScVal(validUntil, { type: "u64" })),
  ]);
}

function mintVoucher1155ToScVal(v: Lazy1155VoucherInput): xdr.ScVal {
  const tokenId = BigInt(v.token_id);
  const buyerQuota = BigInt(v.buyer_quota);
  const pricePer = BigInt(v.price_per_unit);
  const validUntil = BigInt(v.valid_until);
  const hashBuf = parseHex32("uri_hash", v.uri_hash);
  if (v.uri.length === 0) throw new Error("uri is required");
  if (!v.currency || !v.currency.startsWith("C")) {
    throw new Error("currency must be a Stellar contract address (SAC)");
  }
  return xdr.ScVal.scvMap([
    mapKeySymbol("token_id", nativeToScVal(tokenId, { type: "u64" })),
    mapKeySymbol("buyer_quota", nativeToScVal(buyerQuota, { type: "u128" })),
    mapKeySymbol("price_per_unit", nativeToScVal(pricePer, { type: "i128" })),
    mapKeySymbol("currency", toAddressScVal(v.currency)),
    mapKeySymbol("uri", nativeToScVal(v.uri, { type: "string" })),
    mapKeySymbol(
      "uri_hash",
      nativeToScVal(Uint8Array.from(hashBuf), { type: "bytes" }),
    ),
    mapKeySymbol("valid_until", nativeToScVal(validUntil, { type: "u64" })),
  ]);
}

/**
 * Redeem a lazy-mint 721 voucher (buyer must sign; pays creator when price &gt; 0).
 */
export async function redeemLazy721(
  buyerPublicKey: string,
  collectionAddress: string,
  voucher: Lazy721VoucherInput,
  signatureHex: string,
): Promise<number> {
  const vsc = mintVoucher721ToScVal(voucher);
  const sig = parseHexSignature("signature", signatureHex);
  const args: xdr.ScVal[] = [
    toAddressScVal(buyerPublicKey),
    vsc,
    nativeToScVal(Uint8Array.from(sig), { type: "bytes" }),
  ];
  const retVal = await invokeContract(
    buyerPublicKey,
    "redeem",
    args,
    false,
    collectionAddress,
  );
  return Number(scValToNative(retVal));
}

/**
 * Redeem a lazy-mint 1155 voucher for `amount` units.
 */
export async function redeemLazy1155(
  buyerPublicKey: string,
  collectionAddress: string,
  voucher: Lazy1155VoucherInput,
  amount: bigint,
  signatureHex: string,
): Promise<void> {
  const vsc = mintVoucher1155ToScVal(voucher);
  const sig = parseHexSignature("signature", signatureHex);
  const args: xdr.ScVal[] = [
    toAddressScVal(buyerPublicKey),
    vsc,
    nativeToScVal(amount, { type: "u128" }),
    nativeToScVal(Uint8Array.from(sig), { type: "bytes" }),
  ];
  await invokeContract(
    buyerPublicKey,
    "redeem",
    args,
    false,
    collectionAddress,
  );
}

function readJsonObject(json: string, label: string): Record<string, unknown> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return raw as Record<string, unknown>;
}

function fieldString(
  o: Record<string, unknown>,
  key: string,
  label: string,
): string {
  const v = o[key];
  if (v === undefined || v === null) {
    throw new Error(`${label}: missing "${key}"`);
  }
  return String(v);
}

export function parseLazy721VoucherJson(json: string): Lazy721VoucherInput {
  const o = readJsonObject(json, "Voucher");
  return {
    token_id: fieldString(o, "token_id", "Voucher"),
    price: fieldString(o, "price", "Voucher"),
    currency: fieldString(o, "currency", "Voucher"),
    uri: fieldString(o, "uri", "Voucher"),
    uri_hash: fieldString(o, "uri_hash", "Voucher"),
    valid_until: fieldString(o, "valid_until", "Voucher"),
  };
}

export function parseLazy1155VoucherJson(json: string): Lazy1155VoucherInput {
  const o = readJsonObject(json, "Voucher");
  return {
    token_id: fieldString(o, "token_id", "Voucher"),
    buyer_quota: fieldString(o, "buyer_quota", "Voucher"),
    price_per_unit: fieldString(o, "price_per_unit", "Voucher"),
    currency: fieldString(o, "currency", "Voucher"),
    uri: fieldString(o, "uri", "Voucher"),
    uri_hash: fieldString(o, "uri_hash", "Voucher"),
    valid_until: fieldString(o, "valid_until", "Voucher"),
  };
}
