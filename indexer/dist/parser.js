"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseMarketplaceEvent = parseMarketplaceEvent;
const stellar_sdk_1 = require("@stellar/stellar-sdk");
// Map contract symbols to human-readable types
const TOPIC_MAP = {
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
    'dep_n721': 'DEPLOY_NORMAL_721',
    'dep_n1155': 'DEPLOY_NORMAL_1155',
    'dep_l721': 'DEPLOY_LAZY_721',
    'dep_l1155': 'DEPLOY_LAZY_1155',
};
function parseMarketplaceEvent(topics, valueXdr, ledger) {
    // Topics might be XDR base64 strings or decoded symbols
    let topic = '';
    try {
        const rawTopic = stellar_sdk_1.xdr.ScVal.fromXDR(topics[0], 'base64');
        topic = (0, stellar_sdk_1.scValToNative)(rawTopic);
    }
    catch {
        topic = topics[0]; // Fallback if already decoded
    }
    const type = TOPIC_MAP[topic];
    if (!type)
        return null;
    const rawVal = stellar_sdk_1.xdr.ScVal.fromXDR(valueXdr, 'base64');
    const nativeData = (0, stellar_sdk_1.scValToNative)(rawVal);
    let listingId = null;
    let actor = '';
    // Extract common fields based on event type structure in events.rs
    if (nativeData.listing_id !== undefined) {
        listingId = BigInt(nativeData.listing_id);
    }
    else if (nativeData.auction_id !== undefined) {
        // For auction events, we might use auction_id as listingId or map it
        listingId = BigInt(nativeData.auction_id);
    }
    // Identify actor based on event type
    if (nativeData.artist)
        actor = nativeData.artist.toString();
    else if (nativeData.creator)
        actor = nativeData.creator.toString();
    else if (nativeData.offerer)
        actor = nativeData.offerer.toString();
    else if (nativeData.bidder)
        actor = nativeData.bidder.toString();
    else if (nativeData.buyer)
        actor = nativeData.buyer.toString();
    // For deploy events the value is a tuple (creator, collection_address)
    // scValToNative returns an array for tuples
    if (type === 'DEPLOY_NORMAL_721' ||
        type === 'DEPLOY_NORMAL_1155' ||
        type === 'DEPLOY_LAZY_721' ||
        type === 'DEPLOY_LAZY_1155') {
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
 * Helper to convert BigInts in an object to strings for JSON storage if needed,
 * though Prisma handles BigInt natively in some cases.
 * For 'Json' field in Prisma, we should convert them to strings or numbers.
 */
function convertBigInts(obj) {
    if (typeof obj === 'bigint')
        return obj.toString();
    if (Array.isArray(obj))
        return obj.map(convertBigInts);
    if (obj !== null && typeof obj === 'object') {
        return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, convertBigInts(v)]));
    }
    return obj;
}
