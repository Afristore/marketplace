"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startPolling = startPolling;
exports.processEvent = processEvent;
exports.revertLedgers = revertLedgers;
const stellar_sdk_1 = require("@stellar/stellar-sdk");
const db_js_1 = __importDefault(require("./db.js"));
const parser_js_1 = require("./parser.js");
const prom_client_1 = require("prom-client");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const RPC_URL = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
const CONTRACT_ID = process.env.MARKETPLACE_CONTRACT_ID || '';
const LAUNCHPAD_CONTRACT_ID = process.env.LAUNCHPAD_CONTRACT_ID || '';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || '5000');
const server = new stellar_sdk_1.rpc.Server(RPC_URL);
// Metrics
const latestLedgerProcessed = new prom_client_1.Gauge({
    name: 'indexer_latest_ledger_processed',
    help: 'The last ledger sequence number processed by the indexer',
});
const networkLatestLedgerGauge = new prom_client_1.Gauge({
    name: 'indexer_network_latest_ledger',
    help: 'The latest ledger sequence number on the network',
});
async function startPolling() {
    console.log(`Starting indexer poller for contract: ${CONTRACT_ID}`);
    while (true) {
        try {
            // 1. Get last indexed ledger
            let syncState = await db_js_1.default.syncState.findUnique({ where: { id: 1 } });
            if (!syncState) {
                syncState = await db_js_1.default.syncState.create({ data: { id: 1, lastLedger: 0, ledgerHash: '' } });
            }
            // 2. Fetch network state to know current ledger
            const networkDetails = await server.getLatestLedger();
            const currentNetworkLedger = networkDetails.sequence;
            networkLatestLedgerGauge.set(currentNetworkLedger);
            latestLedgerProcessed.set(syncState.lastLedger);
            // 3. Check for chain re-organization
            // If our last known ledger is the network's latest (or ahead?), check if the hash matches.
            // Note: In a real scenario with high throughput, we'd check the hash of the specific lastLedger.
            // For Soroban RPC, we can at least check if we are at the tip.
            if (syncState.lastLedger === currentNetworkLedger && syncState.ledgerHash && syncState.ledgerHash !== networkDetails.id) {
                console.warn(`Chain re-org detected at ledger ${syncState.lastLedger}. Expected ${syncState.ledgerHash}, got ${networkDetails.id}`);
                await revertLedgers(syncState.lastLedger - 1);
                continue; // Restart polling from previous ledger
            }
            // 4. Get events from lastLedger + 1
            const startLedger = syncState.lastLedger + 1;
            if (startLedger > currentNetworkLedger) {
                // Already at tip
                await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
                continue;
            }
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
                // To accurately track continuity, we store the hash of the latest ledger we've seen.
                // If we processed multiple ledgers, we should ideally store the hash of the last one.
                // Since getEvents doesn't return hashes, we fetch the latest ledger info if we reached the tip.
                let ledgerHash = syncState.ledgerHash;
                if (maxLedger === currentNetworkLedger) {
                    ledgerHash = networkDetails.id;
                }
                await db_js_1.default.syncState.update({
                    where: { id: 1 },
                    data: {
                        lastLedger: maxLedger,
                        ledgerHash: ledgerHash
                    },
                });
                latestLedgerProcessed.set(maxLedger);
            }
            else {
                // No events but we might have progressed ledgers if we were behind the tip
                if (currentNetworkLedger > syncState.lastLedger) {
                    // We can safely jump to the tip if no events were found in the range?
                    // No, getEvents should return all events. If no events, we just update lastLedger.
                    await db_js_1.default.syncState.update({
                        where: { id: 1 },
                        data: {
                            lastLedger: currentNetworkLedger,
                            ledgerHash: networkDetails.id
                        },
                    });
                    latestLedgerProcessed.set(currentNetworkLedger);
                }
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
async function revertLedgers(toLedger) {
    console.log(`Reverting database to ledger ${toLedger}`);
    // 1. Identify affected entities before deleting events
    const affectedListings = await db_js_1.default.marketplaceEvent.findMany({
        where: { ledgerSequence: { gt: toLedger } },
        select: { listingId: true },
        distinct: ['listingId'],
    });
    const affectedCollections = await db_js_1.default.marketplaceEvent.findMany({
        where: {
            ledgerSequence: { gt: toLedger },
            eventType: { startsWith: 'DEPLOY_' }
        },
        select: { data: true },
    });
    // 2. Delete events from the database
    await db_js_1.default.marketplaceEvent.deleteMany({
        where: { ledgerSequence: { gt: toLedger } },
    });
    // 3. Revert Listing states
    for (const item of affectedListings) {
        if (item.listingId) {
            await recomputeListingState(item.listingId);
        }
    }
    // 4. Revert Collections (delete if they were deployed in the reverted ledgers)
    for (const item of affectedCollections) {
        const data = item.data;
        const contractAddr = Array.isArray(data) ? data[1]?.toString() : '';
        if (contractAddr) {
            await db_js_1.default.collection.deleteMany({
                where: { contractAddress: contractAddr, deployedAtLedger: { gt: toLedger } }
            });
        }
    }
    // 5. Update sync state
    await db_js_1.default.syncState.update({
        where: { id: 1 },
        data: {
            lastLedger: toLedger,
            ledgerHash: null // Reset hash as we don't know the hash of the old ledger easily
        },
    });
}
async function recomputeListingState(listingId) {
    console.log(`Recomputing state for listing ${listingId}`);
    const events = await db_js_1.default.marketplaceEvent.findMany({
        where: { listingId },
        orderBy: { ledgerSequence: 'asc' },
    });
    if (events.length === 0) {
        // If no events left, delete the listing
        await db_js_1.default.listing.deleteMany({ where: { listingId } });
        return;
    }
    // Apply events in order to reconstruct the state
    // This is a simplified version of processEvent but specifically for one listing
    for (let i = 0; i < events.length; i++) {
        const event = events[i];
        const { eventType, actor, ledgerSequence, data: rawData } = event;
        const data = rawData;
        if (i === 0) {
            // First event must be creation
            await db_js_1.default.listing.upsert({
                where: { listingId },
                create: {
                    listingId,
                    artist: data.artist || actor,
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
                    status: 'Active',
                    updatedAtLedger: ledgerSequence,
                }
            });
        }
        else {
            // Apply subsequent updates
            switch (eventType) {
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
                case 'AUCTION_CREATED':
                    await db_js_1.default.listing.update({
                        where: { listingId },
                        data: {
                            status: 'Auction',
                            updatedAtLedger: ledgerSequence,
                        }
                    });
                    break;
            }
        }
    }
}
