import { xdr, Address, scValToNative } from '@stellar/stellar-sdk';

export interface DecodedEvent {
  eventType: string;
  listingId: bigint | null;
  actor: string;
  ledgerSequence: number;
  data: any;
}

// Map contract symbols to human-readable types
const TOPIC_MAP: Record<string, string> = {
  'lst_crtd': 'LISTING_CREATED',
  'art_sold': 'ARTWORK_SOLD',
  'lst_cncl': 'LISTING_CANCELLED',
  'lst_updt': 'LISTING_UPDATED',
  'bid_plcd': 'BID_PLACED',
  'auc_rslv': 'AUCTION_RESOLVED',
  'auc_cncl': 'AUCTION_CANCELLED',
  'ofr_made': 'OFFER_MADE',
  'ofr_accp': 'OFFER_ACCEPTED',
  'ofr_rjct': 'OFFER_REJECTED',
  'ofr_wdrn': 'OFFER_WITHDRAWN',
  'auc_crtd': 'AUCTION_CREATED',
  'dep_n721': 'DEPLOY_NORMAL_721',
  'dep_n1155': 'DEPLOY_NORMAL_1155',
  'dep_l721': 'DEPLOY_LAZY_721',
  'dep_l1155': 'DEPLOY_LAZY_1155',
  'staked': 'NFT_STAKED',
  'unstkd': 'NFT_UNSTAKED',
  'reward': 'REWARDS_CLAIMED',
};

export function parseMarketplaceEvent(
  topics: string[],
  valueXdr: string,
  ledger: number
): DecodedEvent | null {
  // Topics might be XDR base64 strings or decoded symbols
  let topic = '';
  try {
    const rawTopic = xdr.ScVal.fromXDR(topics[0], 'base64');
    topic = scValToNative(rawTopic);
  } catch {
    topic = topics[0]; // Fallback if already decoded
  }

  const type = TOPIC_MAP[topic];
  if (!type) return null;

  const rawVal = xdr.ScVal.fromXDR(valueXdr, 'base64');
  const nativeData = scValToNative(rawVal);

  let listingId: bigint | null = null;
  let actor: string = '';

  // Extract common fields based on event type structure in events.rs
  if (nativeData.listing_id !== undefined) {
    listingId = BigInt(nativeData.listing_id);
  } else if (nativeData.auction_id !== undefined) {
    // For auction events, we might use auction_id as listingId or map it
    listingId = BigInt(nativeData.auction_id);
  }

  // Identify actor based on event type
  if (nativeData.artist) actor = nativeData.artist.toString();
  else if (nativeData.creator) actor = nativeData.creator.toString();
  else if (nativeData.offerer) actor = nativeData.offerer.toString();
  else if (nativeData.bidder) actor = nativeData.bidder.toString();
  else if (nativeData.buyer) actor = nativeData.buyer.toString();
  else if (nativeData.user) actor = nativeData.user.toString();

  // For deploy events the value is a tuple (creator, collection_address)
  // scValToNative returns an array for tuples
  if (
    type === 'DEPLOY_NORMAL_721' ||
    type === 'DEPLOY_NORMAL_1155' ||
    type === 'DEPLOY_LAZY_721' ||
    type === 'DEPLOY_LAZY_1155'
  ) {
    if (Array.isArray(nativeData) && nativeData.length >= 2) {
      actor = nativeData[0].toString(); // creator address
    }
  }

  return {
    eventType: type,
    listingId,
    actor,
    ledgerSequence: ledger,
    data: convertBigInts(nativeData),
  };
}

/**
 * Extracts the ERC-1155 token quantity from a decoded event data object.
 * Returns 1 for ERC-721 events that do not carry an amount field.
 */
export function extractAmount(nativeData: any): number {
  if (nativeData === null || nativeData === undefined) return 1;
  if (typeof nativeData !== 'object' || Array.isArray(nativeData)) return 1;
  const raw = nativeData.amount ?? nativeData.quantity ?? nativeData.value;
  if (raw === undefined || raw === null) return 1;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Helper to convert BigInts in an object to strings for JSON storage if needed,
 * though Prisma handles BigInt natively in some cases.
 * For 'Json' field in Prisma, we should convert them to strings or numbers.
 */
function convertBigInts(obj: any): any {
  if (typeof obj === 'bigint') return obj.toString();
  if (Array.isArray(obj)) return obj.map(convertBigInts);
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, convertBigInts(v)])
    );
  }
  return obj;
}
