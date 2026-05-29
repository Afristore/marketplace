import { rpc, Contract, TransactionBuilder, BASE_FEE, nativeToScVal, scValToNative } from '@stellar/stellar-sdk';
import prisma from './db.js';
import { parseMarketplaceEvent } from './parser.js';
import { emitSSEEvent } from './api/routes.js';
import dotenv from 'dotenv';
import {
  latestLedgerProcessedGauge,
  networkLatestLedgerGauge,
  syncLatencyGauge
} from './metrics.js';

dotenv.config();

const RPC_URL = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
const CONTRACT_ID = process.env.MARKETPLACE_CONTRACT_ID || '';
const LAUNCHPAD_CONTRACT_ID = process.env.LAUNCHPAD_CONTRACT_ID || '';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || '5000');

// Stellar RPC enforces a maximum getEvents window of 17,280 ledgers (~24 h).
const MAX_LEDGER_WINDOW = 17_000;

// Retry back-off base in ms; doubles on each consecutive failure up to MAX_BACKOFF_MS.
const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;

let consecutiveErrors = 0;

const server = new rpc.Server(RPC_URL);

/**
 * Rolls the database back to `safeAtLedger` by deleting all events and
 * listings that were written past that ledger, then resets SyncState.
 * Called when a chain re-org is detected.
 */
export async function revertLedgers(safeAtLedger: number): Promise<void> {
  console.warn(`[Reorg] Rolling back to ledger ${safeAtLedger}`);
  await prisma.$transaction(async (tx) => {
    // Remove events that occurred after the safe checkpoint
    await tx.marketplaceEvent.deleteMany({
      where: { ledgerSequence: { gt: safeAtLedger } },
    });

    // Remove listings that were first created after the safe checkpoint
    await tx.listing.deleteMany({
      where: { createdAtLedger: { gt: safeAtLedger } },
    });

    // Revert listings whose status changed after the safe checkpoint back to Active
    await tx.listing.updateMany({
      where: { updatedAtLedger: { gt: safeAtLedger } },
      data: { status: 'Active', updatedAtLedger: safeAtLedger },
    });

    // Reset collections deployed after the safe checkpoint
    await tx.collection.deleteMany({
      where: { deployedAtLedger: { gt: safeAtLedger } },
    });

    // Reset the sync cursor
    await tx.syncState.update({
      where: { id: 1 },
      data: { lastLedger: safeAtLedger, lastLedgerHash: null },
    });
  });
  console.log(`[Reorg] Rollback complete. Resuming from ledger ${safeAtLedger + 1}`);
}

export async function startPolling() {
  console.log(`Starting indexer poller for contract: ${CONTRACT_ID}`);

  while (true) {
    try {
      // 1. Get last indexed ledger
      let syncState = await prisma.syncState.findUnique({ where: { id: 1 } });
      if (!syncState) {
        syncState = await prisma.syncState.create({
          data: { id: 1, lastLedger: 0, ledgerHash: null }
        });
      }

      // 2. Validate hash continuity on every poll
      if (syncState.lastLedger > 0 && syncState.ledgerHash) {
        try {
          const ledgersRes = await server.getLedgers({
            startLedger: syncState.lastLedger,
            pagination: { limit: 1 }
          });
          if (ledgersRes.ledgers && ledgersRes.ledgers.length > 0) {
            const networkLedger = ledgersRes.ledgers[0];
            if (networkLedger.hash !== syncState.ledgerHash) {
              console.warn(`Chain re-org detected at ledger ${syncState.lastLedger}! DB hash: ${syncState.ledgerHash}, Network hash: ${networkLedger.hash}`);
              const toLedger = Math.max(0, syncState.lastLedger - 1);
              await revertLedgers(toLedger);
              continue; // Restart the loop immediately with the reverted state
            }
          }
        } catch (err) {
          console.error(`Error validating ledger hash continuity at ledger ${syncState.lastLedger}:`, err);
        }
      }

      // 3. Resolve start ledger, clamping to the safe RPC window on every poll
      let networkLatestLedger: number;
      try {
        const latestRes = await server.getLatestLedger();
        networkLatestLedger = latestRes.sequence;
      } catch (err) {
        console.error({ msg: 'Failed to fetch latest ledger', err });
        throw err;
      }

      const windowFloor = networkLatestLedger - MAX_LEDGER_WINDOW;
      let startLedger = syncState.lastLedger + 1;
      if (startLedger < windowFloor) {
        console.warn({
          msg: 'startLedger too old — resetting to safe window floor',
          requested: startLedger,
          windowFloor,
          networkLatest: networkLatestLedger,
        });
        startLedger = windowFloor;
        // Persist the reset so future polls don't re-request the stale range.
        await prisma.syncState.update({
          where: { id: 1 },
          data: { lastLedger: windowFloor - 1, ledgerHash: null },
        });
      }

      // 2. Fetch events from lastLedger + 1
      const startLedger = syncState.lastLedger + 1;

      const response = await server.getEvents({
        startLedger,
        filters: [
          {
            type: 'contract',
            contractIds: [CONTRACT_ID, LAUNCHPAD_CONTRACT_ID].filter(Boolean),
          },
        ],
      });

      // 3. Re-org detection: if the node's latest ledger has fallen behind what
      //    we already indexed, the node reset or we connected to a different one.
      if (syncState.lastLedger > 0 && response.latestLedger < syncState.lastLedger) {
        console.warn(
          `[Reorg] Network latestLedger ${response.latestLedger} < indexed ${syncState.lastLedger}`
        );
        await revertLedgers(response.latestLedger);
        continue;
      }

      if (response.events && response.events.length > 0) {
        console.log(`Found ${response.events.length} new events since ledger ${syncState.lastLedger}`);

        let maxLedger = syncState.lastLedger;

        for (const event of response.events) {
          // Topics in v14 are ScVal, need to convert to strings (symbol or other)
          const topicStrings = event.topic.map(t => {
            if (typeof t === 'string') return t;
            return t.toXDR('base64');
          });

          const decoded = parseMarketplaceEvent(
            topicStrings,
            typeof event.value === 'string' ? event.value : event.value.toXDR('base64'),
            event.ledger
          );
          if (decoded) {
            await processEvent(decoded);
          }
          if (event.ledger > maxLedger) maxLedger = event.ledger;
        }

        // 4. Persist the new cursor with the network's latest ledger hash
        await prisma.syncState.update({
          where: { id: 1 },
          data: {
            lastLedger: maxLedger,
            lastLedgerHash: String(response.latestLedger),
          },
        });
        
        latestLedgerProcessedGauge.set(updatedState.lastLedger);
        syncLatencyGauge.set(Math.max(0, networkLatest - updatedState.lastLedger));
      } else if (response.latestLedger && response.latestLedger > syncState.lastLedger) {
        // If there are no events but the network has advanced, we can catch up the syncState
        // so we don't scan empty ranges repeatedly. Fetch the hash for the latest ledger.
        let newHash: string | null = null;
        try {
          const ledgersRes = await server.getLedgers({
            startLedger: response.latestLedger,
            pagination: { limit: 1 }
          });
          if (ledgersRes.ledgers && ledgersRes.ledgers.length > 0) {
            newHash = ledgersRes.ledgers[0].hash;
          }
        } catch (err) {
          console.error(`Failed to fetch hash for latest network ledger ${response.latestLedger}:`, err);
        }

        const updatedState = await prisma.syncState.update({
          where: { id: 1 },
          data: {
            lastLedger: response.latestLedger,
            ledgerHash: newHash,
          },
        });

        latestLedgerProcessedGauge.set(updatedState.lastLedger);
        syncLatencyGauge.set(Math.max(0, networkLatest - updatedState.lastLedger));
      }

      consecutiveErrors = 0;
    } catch (error) {
      consecutiveErrors += 1;
      const backoff = Math.min(
        BASE_BACKOFF_MS * Math.pow(2, consecutiveErrors - 1),
        MAX_BACKOFF_MS
      );
      console.error({
        msg: 'Error in polling loop',
        consecutiveErrors,
        backoffMs: backoff,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      await new Promise((resolve) => setTimeout(resolve, backoff));
      continue;
    }

    consecutiveErrors = 0;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

export async function processEvent(event: any) {
  const { eventType, listingId, actor, ledgerSequence, data } = event;

  // 1. Log to MarketplaceEvent history
  await prisma.marketplaceEvent.create({
    data: {
      listingId,
      eventType,
      actor,
      ledgerSequence,
      data,
    },
  });

  // 2. Handle deploy events (no listingId — collection deployments)
  if (eventType === 'DEPLOY_NORMAL_721' || eventType === 'DEPLOY_NORMAL_1155' ||
      eventType === 'DEPLOY_LAZY_721' || eventType === 'DEPLOY_LAZY_1155') {
    const kindMap: Record<string, string> = {
      DEPLOY_NORMAL_721:  'normal_721',
      DEPLOY_NORMAL_1155: 'normal_1155',
      DEPLOY_LAZY_721:    'lazy_721',
      DEPLOY_LAZY_1155:   'lazy_1155',
    };
    const rawData = Array.isArray(data) ? data : [];
    const creatorAddr  = rawData[0]?.toString() || actor;
    const contractAddr = rawData[1]?.toString() || '';
    if (contractAddr) {
      await prisma.collection.upsert({
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
    return;
  }

  // 3. Update Listing state based on event type
  if (!listingId) return;

  switch (eventType) {
    case 'LISTING_CREATED': {
      let chainListing = await fetchListingFromChain(listingId);
      if (chainListing && !chainListing.artist) {
        chainListing = null;
      }
      
      const artist = chainListing ? chainListing.artist.toString() : data.artist;
      const price = chainListing ? chainListing.price.toString() : data.price;
      const currency = chainListing ? chainListing.currency.toString() : data.currency;
      const metadataCid = chainListing 
        ? (chainListing.metadata_cid instanceof Uint8Array 
            ? new TextDecoder().decode(chainListing.metadata_cid) 
            : chainListing.metadata_cid.toString())
        : data.metadata_cid;
      const token = chainListing ? chainListing.token.toString() : (data.token || '');
      const royaltyBps = chainListing ? Number(chainListing.royalty_bps) : (data.royalty_bps || 0);
      const originalCreator = chainListing ? chainListing.original_creator.toString() : artist;
      
      const recipients = chainListing 
        ? chainListing.recipients.map((r: any) => ({
            address: r.address.toString(),
            percentage: Number(r.percentage)
          }))
        : [];

      await prisma.listing.upsert({
        where: { listingId },
        create: {
          listingId,
          artist,
          owner: null,
          price,
          currency,
          metadataCid,
          token,
          status: 'Active',
          royaltyBps,
          originalCreator,
          recipients,
          createdAtLedger: ledgerSequence,
          updatedAtLedger: ledgerSequence,
        },
        update: {
          artist,
          price,
          metadataCid,
          status: 'Active',
          originalCreator,
          recipients,
          updatedAtLedger: ledgerSequence,
        }
      });
      break;
    }

    case 'LISTING_UPDATED':
      await prisma.listing.update({
        where: { listingId },
        data: {
          price: data.new_price,
          metadataCid: data.metadata_cid,
          updatedAtLedger: ledgerSequence,
        },
      });
      break;

    case 'ARTWORK_SOLD':
      await prisma.listing.update({
        where: { listingId },
        data: {
          status: 'Sold',
          owner: data.buyer,
          updatedAtLedger: ledgerSequence,
        },
      });
      break;

    case 'LISTING_CANCELLED':
      await prisma.listing.update({
        where: { listingId },
        data: {
          status: 'Cancelled',
          updatedAtLedger: ledgerSequence,
        },
      });
      break;
    
    case 'AUCTION_CREATED': {
      let chainAuction = await fetchAuctionFromChain(listingId);
      if (chainAuction && !chainAuction.creator) {
        chainAuction = null;
      }
      
      const creator = chainAuction ? chainAuction.creator.toString() : data.creator;
      const reservePrice = chainAuction ? chainAuction.reserve_price.toString() : (data.reserve_price || '0');
      const token = chainAuction ? chainAuction.token.toString() : (data.token || '');
      const endTime = chainAuction ? BigInt(chainAuction.end_time) : BigInt(data.end_time || 0);
      const royaltyBps = chainAuction ? Number(chainAuction.royalty_bps) : Number(data.royalty_bps || 0);
      const originalCreator = chainAuction ? chainAuction.original_creator.toString() : creator;
      const metadataCid = chainAuction 
        ? (chainAuction.metadata_cid instanceof Uint8Array 
            ? new TextDecoder().decode(chainAuction.metadata_cid) 
            : chainAuction.metadata_cid.toString())
        : (data.metadata_cid || '');
      const recipients = chainAuction 
        ? chainAuction.recipients.map((r: any) => ({
            address: r.address.toString(),
            percentage: Number(r.percentage)
          }))
        : [];

      await prisma.auction.upsert({
        where: { auctionId: listingId },
        create: {
          auctionId: listingId,
          creator,
          metadataCid,
          token,
          reservePrice,
          highestBid: '0',
          highestBidder: null,
          endTime,
          status: 'Active',
          recipients,
          royaltyBps,
          originalCreator,
          createdAtLedger: ledgerSequence,
          updatedAtLedger: ledgerSequence,
        },
        update: {
          creator,
          metadataCid,
          token,
          reservePrice,
          endTime,
          status: 'Active',
          recipients,
          royaltyBps,
          originalCreator,
          updatedAtLedger: ledgerSequence,
        }
      });
      break;
    }

    case 'BID_PLACED': {
      await prisma.auction.update({
        where: { auctionId: listingId },
        data: {
          highestBid: data.bid_amount,
          highestBidder: data.bidder,
          updatedAtLedger: ledgerSequence,
        }
      });
      break;
    }

    case 'AUCTION_RESOLVED': {
      await prisma.auction.update({
        where: { auctionId: listingId },
        data: {
          status: 'Finalized',
          highestBid: data.amount,
          highestBidder: data.winner || null,
          updatedAtLedger: ledgerSequence,
        }
      });
      break;
    }

    case 'OFFER_MADE': {
      await prisma.offer.upsert({
        where: { offerId: BigInt(data.offer_id) },
        create: {
          offerId: BigInt(data.offer_id),
          listingId: BigInt(data.listing_id),
          offerer: data.offerer,
          amount: data.amount,
          token: data.token,
          status: 'Pending',
          createdAtLedger: ledgerSequence,
          updatedAtLedger: ledgerSequence,
        },
        update: {
          listingId: BigInt(data.listing_id),
          offerer: data.offerer,
          amount: data.amount,
          token: data.token,
          status: 'Pending',
          updatedAtLedger: ledgerSequence,
        }
      });
      break;
    }

    case 'OFFER_ACCEPTED': {
      await prisma.offer.update({
        where: { offerId: BigInt(data.offer_id) },
        data: {
          status: 'Accepted',
          updatedAtLedger: ledgerSequence,
        }
      });
      await prisma.listing.update({
        where: { listingId: BigInt(data.listing_id) },
        data: {
          status: 'Sold',
          owner: data.offerer,
          updatedAtLedger: ledgerSequence,
        }
      }).catch(() => {});
      break;
    }

    case 'OFFER_REJECTED': {
      await prisma.offer.update({
        where: { offerId: BigInt(data.offer_id) },
        data: {
          status: 'Rejected',
          updatedAtLedger: ledgerSequence,
        }
      });
      break;
    }

    case 'OFFER_WITHDRAWN': {
      await prisma.offer.update({
        where: { offerId: BigInt(data.offer_id) },
        data: {
          status: 'Withdrawn',
          updatedAtLedger: ledgerSequence,
        }
      });
      break;
    }

  }

  // Broadcast to any connected SSE clients after the DB write is complete.
  emitSSEEvent(event);
}
