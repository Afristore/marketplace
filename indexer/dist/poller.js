"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startPolling = startPolling;
exports.processEvent = processEvent;
const stellar_sdk_1 = require("@stellar/stellar-sdk");
const db_js_1 = __importDefault(require("./db.js"));
const parser_js_1 = require("./parser.js");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const RPC_URL = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
const CONTRACT_ID = process.env.MARKETPLACE_CONTRACT_ID || '';
const LAUNCHPAD_CONTRACT_ID = process.env.LAUNCHPAD_CONTRACT_ID || '';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || '5000');
const server = new stellar_sdk_1.rpc.Server(RPC_URL);
async function startPolling() {
    console.log(`Starting indexer poller for contract: ${CONTRACT_ID}`);
    while (true) {
        try {
            // 1. Get last indexed ledger
            let syncState = await db_js_1.default.syncState.findUnique({ where: { id: 1 } });
            if (!syncState) {
                syncState = await db_js_1.default.syncState.create({ data: { id: 1, lastLedger: 0 } });
            }
            // 2. Fetch network state to know current ledger
            // const networkDetails = await server.getNetwork();
            // 3. Get events from lastLedger + 1
            const startLedger = syncState.lastLedger + 1;
            const response = await server.getEvents({
                startLedger: startLedger,
                filters: [
                    {
                        type: 'contract',
                        contractIds: [CONTRACT_ID, LAUNCHPAD_CONTRACT_ID].filter(Boolean),
                    },
                ],
            });
            if (response.events && response.events.length > 0) {
                console.log(`Found ${response.events.length} new events since ledger ${syncState.lastLedger}`);
                let maxLedger = syncState.lastLedger;
                for (const event of response.events) {
                    // Topics in v14 are ScVal, need to convert to strings (symbol or other)
                    const topicStrings = event.topic.map(t => {
                        if (typeof t === 'string')
                            return t; // Already a string/base64
                        return t.toXDR('base64'); // If it's an ScVal object
                    });
                    const decoded = (0, parser_js_1.parseMarketplaceEvent)(topicStrings, typeof event.value === 'string' ? event.value : event.value.toXDR('base64'), event.ledger);
                    if (decoded) {
                        await processEvent(decoded);
                    }
                    if (event.ledger > maxLedger)
                        maxLedger = event.ledger;
                }
                // Update sync state
                await db_js_1.default.syncState.update({
                    where: { id: 1 },
                    data: { lastLedger: maxLedger },
                });
            }
        }
        catch (error) {
            console.error('Error in polling loop:', error);
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
    }
}
async function processEvent(event) {
    const { eventType, listingId, actor, ledgerSequence, data } = event;
    // 1. Log to MarketplaceEvent history
    await db_js_1.default.marketplaceEvent.create({
        data: {
            listingId,
            eventType,
            actor,
            ledgerSequence,
            data,
        },
    });
    // 2. Update Listing state based on event type
    if (!listingId)
        return;
    switch (eventType) {
        case 'LISTING_CREATED':
            await db_js_1.default.listing.upsert({
                where: { listingId },
                create: {
                    listingId,
                    artist: data.artist,
                    owner: null,
                    price: data.price,
                    currency: data.currency,
                    metadataCid: data.metadata_cid,
                    token: data.token || '',
                    status: 'Active',
                    royaltyBps: data.royalty_bps || 0,
                    createdAtLedger: ledgerSequence,
                    updatedAtLedger: ledgerSequence,
                },
                update: {
                    artist: data.artist,
                    price: data.price,
                    metadataCid: data.metadata_cid,
                    status: 'Active',
                    updatedAtLedger: ledgerSequence,
                }
            });
            break;
        case 'LISTING_UPDATED':
            await db_js_1.default.listing.update({
                where: { listingId },
                data: {
                    price: data.new_price,
                    metadataCid: data.metadata_cid,
                    updatedAtLedger: ledgerSequence,
                },
            });
            break;
        case 'ARTWORK_SOLD':
            await db_js_1.default.listing.update({
                where: { listingId },
                data: {
                    status: 'Sold',
                    owner: data.buyer,
                    updatedAtLedger: ledgerSequence,
                },
            });
            break;
        case 'LISTING_CANCELLED':
            await db_js_1.default.listing.update({
                where: { listingId },
                data: {
                    status: 'Cancelled',
                    updatedAtLedger: ledgerSequence,
                },
            });
            break;
        // For Auctions and Offers, we might add more logic or separate tables if needed.
        // For now, we mainly update listing status if an auction starts.
        case 'AUCTION_CREATED':
            await db_js_1.default.listing.update({
                where: { listingId },
                data: {
                    status: 'Auction',
                    updatedAtLedger: ledgerSequence,
                }
            });
            break;
        case 'DEPLOY_NORMAL_721':
        case 'DEPLOY_NORMAL_1155':
        case 'DEPLOY_LAZY_721':
        case 'DEPLOY_LAZY_1155': {
            const kindMap = {
                DEPLOY_NORMAL_721: 'normal_721',
                DEPLOY_NORMAL_1155: 'normal_1155',
                DEPLOY_LAZY_721: 'lazy_721',
                DEPLOY_LAZY_1155: 'lazy_1155',
            };
            // data is the raw tuple array [creator, collectionAddress]
            const rawData = Array.isArray(data) ? data : [];
            const creatorAddr = rawData[0]?.toString() || actor;
            const contractAddr = rawData[1]?.toString() || '';
            if (contractAddr) {
                await db_js_1.default.collection.upsert({
                    where: { contractAddress: contractAddr },
                    create: {
                        contractAddress: contractAddr,
                        kind: kindMap[eventType],
                        creator: creatorAddr,
                        deployedAtLedger: ledgerSequence,
                    },
                    update: {
                        creator: creatorAddr,
                        deployedAtLedger: ledgerSequence,
                    },
                });
            }
            break;
        }
    }
}
