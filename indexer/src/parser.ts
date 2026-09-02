import { xdr, Address, scValToNative } from '@stellar/stellar-sdk';

export interface DecodedEvent {
  eventType: string;
  listingId: bigint | null;
  positionId?: bigint | null;
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
  'pos_liq': 'POSITION_LIQUIDATED',
  'pos_liquidated': 'POSITION_LIQUIDATED',
  'Liquidated': 'POSITION_LIQUIDATED',
  'POSITION_LIQUIDATED': 'POSITION_LIQUIDATED',
  'cur_wl': 'CURRENCY_WHITELISTED',
  'currency_whitelisted': 'CURRENCY_WHITELISTED',
  'CurrencyWhitelisted': 'CURRENCY_WHITELISTED',
  'CURRENCY_WHITELISTED': 'CURRENCY_WHITELISTED',
  'cur_rmv': 'CURRENCY_REMOVED',
  'currency_removed': 'CURRENCY_REMOVED',
  'CurrencyRemoved': 'CURRENCY_REMOVED',
  'CURRENCY_REMOVED': 'CURRENCY_REMOVED',
  'pos_open': 'POSITION_OPENED',
  'col_add': 'COLLATERAL_ADDED',
  'pos_ret': 'POSITION_RETURNED',
};

const LENDING_SUBTOPIC_MAP: Record<string, string> = {
  'lst_crtd': 'LENDING_LISTING_CREATED',
  'lst_cncl': 'LENDING_LISTING_CANCELLED',
  'pos_open': 'POSITION_OPENED',
  'col_add': 'COLLATERAL_ADDED',
  'pos_ret': 'POSITION_RETURNED',
  'pos_liq': 'POSITION_LIQUIDATED',
  'cur_wl': 'CURRENCY_WHITELISTED',
  'cur_rmv': 'CURRENCY_REMOVED',
};

export function parseMarketplaceEvent(
  topics: string[],
  valueXdr: string,
  ledger: number
): DecodedEvent | null {
  if (!topics || topics.length === 0) return null;

  // Topics might be XDR base64 strings or decoded symbols
  let topic = '';
  try {
    const rawTopic = xdr.ScVal.fromXDR(topics[0], 'base64');
    topic = scValToNative(rawTopic);
  } catch {
    topic = topics[0]; // Fallback if already decoded
  }

  let type = TOPIC_MAP[topic];

  // Handle multi-topic lending events published under (symbol_short!("lending"), subtopic)
  if (topic === 'lending' && topics.length > 1) {
    let subTopic = '';
    try {
      const rawSub = xdr.ScVal.fromXDR(topics[1], 'base64');
      subTopic = scValToNative(rawSub);
    } catch {
      subTopic = topics[1];
    }
    type = LENDING_SUBTOPIC_MAP[subTopic] || TOPIC_MAP[subTopic] || subTopic;
  }

  if (!type && TOPIC_MAP[topic]) {
    type = TOPIC_MAP[topic];
  } else if (!type) {
    if (topic === 'Liquidated' || topic === 'POSITION_LIQUIDATED') type = 'POSITION_LIQUIDATED';
    else if (topic === 'CurrencyWhitelisted' || topic === 'CURRENCY_WHITELISTED') type = 'CURRENCY_WHITELISTED';
    else if (topic === 'CurrencyRemoved' || topic === 'CURRENCY_REMOVED') type = 'CURRENCY_REMOVED';
  }

  if (!type) return null;

  let rawVal: any;
  let nativeData: any;
  try {
    rawVal = xdr.ScVal.fromXDR(valueXdr, 'base64');
    nativeData = scValToNative(rawVal);
  } catch {
    return null; // Malformed value XDR → ignore the event
  }

  let listingId: bigint | null = null;
  let actor: string = '';

  // Extract common fields based on event type structure in events.rs
  if (nativeData.listing_id !== undefined) {
    listingId = BigInt(nativeData.listing_id);
  } else if (nativeData.auction_id !== undefined) {
    // For auction events, we might use auction_id as listingId or map it
    listingId = BigInt(nativeData.auction_id);
  } else if (nativeData.position_id !== undefined) {
    listingId = BigInt(nativeData.position_id);
  }

  // Identify actor based on event type
  if (nativeData.liquidator) actor = nativeData.liquidator.toString();
  else if (nativeData.borrower) actor = nativeData.borrower.toString();
  else if (nativeData.lender) actor = nativeData.lender.toString();
  else if (nativeData.artist) actor = nativeData.artist.toString();
  else if (nativeData.creator) actor = nativeData.creator.toString();
  else if (nativeData.borrower) actor = nativeData.borrower.toString();
  else if (nativeData.offerer) actor = nativeData.offerer.toString();
  else if (nativeData.bidder) actor = nativeData.bidder.toString();
  else if (nativeData.buyer) actor = nativeData.buyer.toString();
  else if (nativeData.user) actor = nativeData.user.toString();
  else if (nativeData.admin) actor = nativeData.admin.toString();

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

// ── Lending Contract Events ────────────────────────────────────────────────────

const LENDING_TOPIC_MAP: Record<string, string> = {
  'lst_crtd': 'LENDING_LISTING_CREATED',
  'lst_cncl': 'LENDING_LISTING_CANCELLED',
  'pos_open': 'LENDING_POSITION_OPENED',
  'col_add':  'LENDING_COLLATERAL_ADDED',
  'pos_ret':  'LENDING_POSITION_RETURNED',
  'pos_liq':  'LENDING_POSITION_LIQUIDATED',
  'cancel':   'LENDING_LISTING_CANCELLED',
  'borrow':   'LENDING_POSITION_OPENED',
};

export interface LendingDecodedEvent {
  eventType: string;
  listingId: bigint | null;
  positionId: bigint | null;
  actor: string;
  ledgerSequence: number;
  data: any;
}

export function parseLendingEvent(
  topics: string[],
  valueXdr: string,
  ledger: number
): LendingDecodedEvent | null {
  let contractTopic = '';
  let eventTopic = '';

  try {
    const rawTopic0 = xdr.ScVal.fromXDR(topics[0], 'base64');
    contractTopic = scValToNative(rawTopic0);
  } catch {
    contractTopic = topics[0] ?? '';
  }

  if (contractTopic !== 'lending') return null;

  try {
    const rawTopic1 = xdr.ScVal.fromXDR(topics[1], 'base64');
    eventTopic = scValToNative(rawTopic1);
  } catch {
    eventTopic = topics[1] ?? '';
  }

  const type = LENDING_TOPIC_MAP[eventTopic];
  if (!type) return null;

  let nativeData: any;
  try {
    const rawVal = xdr.ScVal.fromXDR(valueXdr, 'base64');
    nativeData = scValToNative(rawVal);
  } catch {
    return null;
  }

  let listingId: bigint | null = null;
  let positionId: bigint | null = null;
  let actor: string = '';

  if (nativeData.listing_id !== undefined) {
    listingId = BigInt(nativeData.listing_id);
  }
  if (nativeData.position_id !== undefined) {
    positionId = BigInt(nativeData.position_id);
  }

  if (nativeData.lender) actor = nativeData.lender.toString();
  else if (nativeData.borrower) actor = nativeData.borrower.toString();
  else if (nativeData.liquidator) actor = nativeData.liquidator.toString();

  return {
    eventType: type,
    listingId,
    positionId,
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
