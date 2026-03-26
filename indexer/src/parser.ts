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
  'ofr_made': 'OFFER_MADE',
  'ofr_accp': 'OFFER_ACCEPTED',
  'ofr_rjct': 'OFFER_REJECTED',
  'ofr_wdrn': 'OFFER_WITHDRAWN',
  'auc_crtd': 'AUCTION_CREATED',
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

  return {
    eventType: type,
    listingId,
    actor,
    ledgerSequence: ledger,
    data: convertBigInts(nativeData),
  };
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
