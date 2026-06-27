import { rpc, Contract, TransactionBuilder, BASE_FEE, nativeToScVal, scValToNative, Keypair, Account } from '@stellar/stellar-sdk';
import prisma from './db.js';
import { emitSSEEvent } from './api/routes.js';
import dotenv from 'dotenv';
import {
  latestLedgerProcessedGauge,
  networkLatestLedgerGauge,
  syncLatencyGauge
} from './metrics.js';
import { collectMarketplaceEvents, MAX_LEDGER_WINDOW } from './event-sync.js';
import redis from './redis.js';

dotenv.config();

const RPC_URL = process.env.STELLAR_RPC_URL || 'https://soroban-testnet.stellar.org';
const CONTRACT_ID = process.env.MARKETPLACE_CONTRACT_ID || '';
const LAUNCHPAD_CONTRACT_ID = process.env.LAUNCHPAD_CONTRACT_ID || '';
const STAKING_CONTRACT_ID = process.env.STAKING_CONTRACT_ID || '';
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || '5000');

// Stay this many ledgers behind the network tip to avoid requesting ledgers that
// are not yet available on every Soroban RPC load balancer node.
const LEDGER_LAG_BUFFER = 2;

// Retry back-off base in ms; doubles on each consecutive failure up to MAX_BACKOFF_MS.
const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;

let consecutiveErrors = 0;

// Graceful shutdown coordination
let shuttingDown = false;

function getContractIds(): string[] {
  return [CONTRACT_ID, LAUNCHPAD_CONTRACT_ID, STAKING_CONTRACT_ID].filter(Boolean);
}

function updateSyncMetrics(processedLedger: number, networkLatestLedger: number) {
  latestLedgerProcessedGauge.set(processedLedger);
  networkLatestLedgerGauge.set(networkLatestLedger);
  syncLatencyGauge.set(Math.max(0, networkLatestLedger - processedLedger));
}

function setupSignalHandlers() {
  const onSignal = (sig: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[Shutdown] Received ${sig} — attempting graceful shutdown`);
    // Start async cleanup; don't await here since signals may be re-delivered
    gracefulShutdown().catch((err) => {
      console.error('[Shutdown] Graceful shutdown failed:', err);
      process.exit(1);
    });
  };
  process.on('SIGTERM', () => onSignal('SIGTERM'));
  process.on('SIGINT', () => onSignal('SIGINT'));
}

async function gracefulShutdown() {
  console.log('[Shutdown] Closing resources: Prisma + Redis');
  const cleanup = Promise.allSettled([
    prisma.$disconnect(),
    // redis may not be connected in some test environments
    (redis && typeof redis.disconnect === 'function') ? redis.disconnect() : Promise.resolve(),
  ]);

  // Timeout fallback: force exit if cleanup hangs
  try {
    await Promise.race([
      cleanup,
      new Promise((_, rej) => setTimeout(() => rej(new Error('shutdown timeout')), 10000)),
    ]);
    console.log('[Shutdown] Cleanup complete, exiting');
    process.exit(0);
  } catch (err) {
    console.error('[Shutdown] Cleanup timed out or errored:', err);
    process.exit(1);
  }
}

// Register handlers immediately so any external SIGTERM/SIGINT will be caught
setupSignalHandlers();

/**
 * Returns true when the Soroban RPC signals that the requested ledger range is
 * outside the node's available window (JSON-RPC error code -32600).  This
 * happens under load-balancer lag and must NOT trigger a database rollback.
 */
function isRpcOutOfBoundsError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  return (
    e['code'] === -32600 ||
    (typeof e['message'] === 'string' &&
      (e['message'] as string).includes('start ledger must be between'))
  );
}

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

/** SyncState fields for a ledger advance; omits hash when fetch failed so we keep the prior checkpoint. */
export function buildSyncStateLedgerData(
  lastLedger: number,
  ledgerHash: string | null
): { lastLedger: number; lastLedgerHash?: string } {
  if (ledgerHash !== null) {
    return { lastLedger, lastLedgerHash: ledgerHash };
  }
  return { lastLedger };
}

export async function validateHashContinuity(
  syncState: { lastLedger: number; lastLedgerHash: string | null },
  rpcServer: rpc.Server
): Promise<boolean> {
  // No stored hash (initial sync or prior hash fetch failure) — cannot detect re-org.
  if (syncState.lastLedger > 0 && syncState.lastLedgerHash) {
    try {
      const ledgersRes = await rpcServer.getLedgers({
        startLedger: syncState.lastLedger,
        pagination: { limit: 1 }
      });
      if (ledgersRes.ledgers && ledgersRes.ledgers.length > 0) {
        const networkLedger = ledgersRes.ledgers[0];
        if (networkLedger.hash !== syncState.lastLedgerHash) {
          console.warn(`Chain re-org detected at ledger ${syncState.lastLedger}! DB hash: ${syncState.lastLedgerHash}, Network hash: ${networkLedger.hash}`);
          const toLedger = Math.max(0, syncState.lastLedger - 1);
          await revertLedgers(toLedger);
          return false;
        }
      }
    } catch (err) {
      console.error(`Error validating ledger hash continuity at ledger ${syncState.lastLedger}:`, err);
    }
  }
  return true;
}

export async function startPolling() {
  const contractIds = getContractIds();
  if (contractIds.length === 0) {
    throw new Error('At least one of MARKETPLACE_CONTRACT_ID or LAUNCHPAD_CONTRACT_ID must be set');
  }

  console.log(`Starting indexer poller for contract(s): ${contractIds.join(', ')}`);

  while (!shuttingDown) {
    try {
      // 1. Get last indexed ledger — upsert avoids a unique-constraint violation
      //    when two instances start simultaneously (race between findUnique + create).
      let syncState = await prisma.syncState.upsert({
        where: { id: 1 },
        create: { id: 1, lastLedger: 0, lastLedgerHash: null },
        update: {},
      });

      // 2. Validate hash continuity on every poll
      const isContinuous = await validateHashContinuity(syncState, server);
      if (!isContinuous) {
        continue; // Restart the loop immediately with the reverted state
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

      networkLatestLedgerGauge.set(networkLatestLedger);

      // Stay a few ledgers behind the tip so all load-balancer nodes have
      // fully committed these ledgers before we request them.
      const effectiveLatestLedger = Math.max(0, networkLatestLedger - LEDGER_LAG_BUFFER);

      if (syncState.lastLedger > 0 && effectiveLatestLedger < syncState.lastLedger) {
        // The RPC appears to be lagging behind our indexed state.  This is a
        // transient load-balancer condition, NOT a chain re-org — real re-orgs
        // are detected below via hash comparison.  Skip this poll iteration.
        console.warn({
          msg: 'Effective latest ledger behind indexed state — possible RPC lag, skipping poll',
          indexedLedger: syncState.lastLedger,
          networkLatestLedger,
          effectiveLatestLedger,
        });
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
        continue;
      }

      const windowFloor = networkLatestLedger - MAX_LEDGER_WINDOW;
      let startLedger = syncState.lastLedger + 1;
      let skippedRange: { from: number; to: number } | null = null;
      if (startLedger < windowFloor) {
        skippedRange = { from: startLedger, to: windowFloor - 1 };
        console.warn({
          msg: 'Skipping ledger gap outside the live RPC window',
          skippedRange,
          windowFloor,
          networkLatest: networkLatestLedger,
        });
        startLedger = windowFloor;
        // Persist the reset so future polls don't re-request the stale range.
        const resetState = await prisma.syncState.update({
          where: { id: 1 },
          data: { lastLedger: windowFloor - 1, lastLedgerHash: null },
        });

        syncState = resetState;
      }
      const decodedEvents = await collectMarketplaceEvents(server, contractIds, startLedger, effectiveLatestLedger);

      let latestHash: string | null = null;
      if (decodedEvents.length > 0) {
        const maxLedger = Math.max(...decodedEvents.map((event) => event.ledgerSequence));
        try {
          const ledgersRes = await server.getLedgers({
            startLedger: maxLedger,
            pagination: { limit: 1 },
          });
          if (ledgersRes.ledgers && ledgersRes.ledgers.length > 0) {
            latestHash = ledgersRes.ledgers[0].hash;
          }
        } catch (err) {
          console.error(`Failed to fetch hash for ledger ${maxLedger}:`, err);
        }

        const { updatedState, newEvents } = await prisma.$transaction(async (tx) => {
          const toInsert = await applyDecodedEvents(decodedEvents, tx);
          const updated = await tx.syncState.update({
            where: { id: 1 },
            data: buildSyncStateLedgerData(maxLedger, latestHash),
          });

          return { updatedState: updated, newEvents: toInsert };
        });

        updateSyncMetrics(updatedState.lastLedger, networkLatestLedger);

        for (const ev of newEvents) emitSSEEvent(ev);
      } else if (effectiveLatestLedger > syncState.lastLedger) {
        try {
          const ledgersRes = await server.getLedgers({
            startLedger: effectiveLatestLedger,
            pagination: { limit: 1 },
          });
          if (ledgersRes.ledgers && ledgersRes.ledgers.length > 0) {
            latestHash = ledgersRes.ledgers[0].hash;
          }
        } catch (err) {
          console.error(`Failed to fetch hash for latest network ledger ${effectiveLatestLedger}:`, err);
        }

        const updatedState = await prisma.syncState.update({
          where: { id: 1 },
          data: buildSyncStateLedgerData(effectiveLatestLedger, latestHash),
        });

        updateSyncMetrics(updatedState.lastLedger, networkLatestLedger);
      } else {
        updateSyncMetrics(syncState.lastLedger, networkLatestLedger);
      }

      consecutiveErrors = 0;
    } catch (error) {
      // RPC out-of-bounds (-32600): the requested ledger is outside the node's
      // available window.  This is transient load-balancer lag — skip the poll
      // cycle without touching the database.
      if (isRpcOutOfBoundsError(error)) {
        console.warn({
          msg: 'RPC out-of-bounds error (-32600) — skipping poll cycle, no DB rollback',
          error: error instanceof Error ? error.message : String(error),
        });
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
        continue;
      }

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

    // If the loop exited due to shutdown signal, ensure resources are cleaned
    if (shuttingDown) {
      await gracefulShutdown();
    }
}

async function fetchListingFromChain(_listingId: bigint): Promise<any | null> {
  return null;
}

async function fetchAuctionFromChain(_auctionId: bigint): Promise<any | null> {
  return null;
}

async function fetchTokenUri(collectionId: string, tokenId: bigint): Promise<string | null> {
  try {
    const rpcServer = new rpc.Server(RPC_URL, { allowHttp: false });
    const contract = new Contract(collectionId);
    const dummy = Keypair.random();
    const account = await rpcServer.getAccount(dummy.publicKey()).catch(() => new Account(dummy.publicKey(), "0"));
    const tx = new TransactionBuilder(account, {
      fee: "10000",
      networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE || "Test SDF Network ; September 2015",
    })
      .addOperation(contract.call("token_uri", nativeToScVal(Number(tokenId), { type: "u64" })))
      .setTimeout(30)
      .build();

    const simResult = await rpcServer.simulateTransaction(tx);
    if (rpc.Api.isSimulationSuccess(simResult)) {
      const retVal = simResult.result?.retval;
      if (retVal) {
        return scValToNative(retVal)?.toString() || null;
      }
    }
  } catch (err) {
    console.error(`Failed to fetch token URI for collection ${collectionId} token ${tokenId}:`, err);
  }
  return null;
}

export async function applyDecodedEvents(decodedEvents: any[], tx: any) {
  const conditions = decodedEvents.map((event) => ({
    listingId: event.listingId ?? null,
    eventType: event.eventType,
    ledgerSequence: event.ledgerSequence,
  }));

  const existing = conditions.length
    ? await tx.marketplaceEvent.findMany({
        where: { OR: conditions },
        select: { listingId: true, eventType: true, ledgerSequence: true },
      })
    : [];

  const existingSet = new Set(
    existing.map((event: any) => `${event.listingId ?? 'null'}|${event.eventType}|${event.ledgerSequence}`)
  );

  const toInsert = decodedEvents.filter(
    (event: any) => !existingSet.has(`${event.listingId ?? 'null'}|${event.eventType}|${event.ledgerSequence}`)
  );

  if (toInsert.length > 0) {
    await tx.marketplaceEvent.createMany({
      data: toInsert.map((event) => ({
        listingId: event.listingId,
        eventType: event.eventType,
        actor: event.actor,
        data: event.data,
        ledgerSequence: event.ledgerSequence,
      })),
      skipDuplicates: true,
    });

    for (const event of toInsert) {
      await processEvent(event, tx, true);
    }
  }

  return toInsert;
}

export async function processEvent(event: any, tx?: any, skipInsert = false) {
  const { eventType, listingId, actor, ledgerSequence, data } = event;

  const db = tx ?? prisma;

  if (!skipInsert) {
    await db.marketplaceEvent.create({
      data: {
        listingId,
        eventType,
        actor,
        ledgerSequence,
        data,
      },
    });
  }

  // Handle deploy events (no listingId — collection deployments)
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
      await db.collection.upsert({
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

  // Update Listing state based on event type
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
      const collection = chainListing ? chainListing.collection.toString() : data.collection;
      const nftTokenId = chainListing ? BigInt(chainListing.token_id) : BigInt(data.token_id);
      const token = chainListing ? chainListing.token.toString() : (data.token || '');
      
      const recipients = chainListing 
        ? chainListing.recipients.map((r: any) => ({
            address: r.address.toString(),
            percentage: Number(r.percentage)
          }))
        : [];

      const metadataCid = await fetchTokenUri(collection, nftTokenId);

      await db.listing.upsert({
        where: { listingId },
        create: {
          listingId,
          artist,
          owner: null,
          price,
          currency,
          collection,
          nftTokenId,
          token,
          metadataCid,
          status: 'Active',
          recipients,
          createdAtLedger: ledgerSequence,
          updatedAtLedger: ledgerSequence,
        },
        update: {
          artist,
          price,
          collection,
          nftTokenId,
          metadataCid,
          status: 'Active',
          recipients,
          updatedAtLedger: ledgerSequence,
        }
      });
      break;
    }

    case 'LISTING_UPDATED': {
      const { count } = await db.listing.updateMany({
        where: { listingId },
        data: {
          price: data.new_price,
          collection: data.collection,
          nftTokenId: BigInt(data.token_id || 0),
          updatedAtLedger: ledgerSequence,
        },
      });
      if (count === 0) console.warn(`LISTING_UPDATED: listing ${listingId} not found at ledger ${ledgerSequence}`);
      break;
    }

    case 'ARTWORK_SOLD': {
      const { count } = await db.listing.updateMany({
        where: { listingId },
        data: {
          status: 'Sold',
          owner: data.buyer,
          updatedAtLedger: ledgerSequence,
        },
      });
      if (count === 0) console.error(`ARTWORK_SOLD: listing ${listingId} not found — sale not recorded at ledger ${ledgerSequence}`);
      break;
    }

    case 'LISTING_CANCELLED': {
      const { count } = await db.listing.updateMany({
        where: { listingId },
        data: {
          status: 'Cancelled',
          updatedAtLedger: ledgerSequence,
        },
      });
      if (count === 0) console.warn(`LISTING_CANCELLED: listing ${listingId} not found at ledger ${ledgerSequence}`);
      break;
    }
    
    case 'AUCTION_CREATED': {
      let chainAuction = await fetchAuctionFromChain(listingId);
      if (chainAuction && !chainAuction.creator) {
        chainAuction = null;
      }
      
      const creator = chainAuction ? chainAuction.creator.toString() : data.creator;
      const reservePrice = chainAuction ? chainAuction.reserve_price.toString() : (data.reserve_price || '0');
      const token = chainAuction ? chainAuction.token.toString() : (data.token || '');
      const endTime = chainAuction ? BigInt(chainAuction.end_time) : BigInt(data.end_time || 0);
      const collection = chainAuction ? chainAuction.collection.toString() : data.collection;
      const nftTokenId = chainAuction ? BigInt(chainAuction.token_id) : BigInt(data.token_id || 0);
      const recipients = chainAuction 
        ? chainAuction.recipients.map((r: any) => ({
            address: r.address.toString(),
            percentage: Number(r.percentage)
          }))
        : [];

      const metadataCid = await fetchTokenUri(collection, nftTokenId);

      await db.auction.upsert({
        where: { auctionId: listingId },
        create: {
          auctionId: listingId,
          creator,
          collection,
          nftTokenId,
          token,
          metadataCid,
          reservePrice,
          highestBid: '0',
          highestBidder: null,
          endTime,
          status: 'Active',
          recipients,
          createdAtLedger: ledgerSequence,
          updatedAtLedger: ledgerSequence,
        },
        update: {
          creator,
          collection,
          nftTokenId,
          token,
          metadataCid,
          reservePrice,
          endTime,
          status: 'Active',
          recipients,
          updatedAtLedger: ledgerSequence,
        }
      });
      break;
    }

    case 'BID_PLACED': {
      const { count } = await db.auction.updateMany({
        where: { auctionId: listingId },
        data: {
          highestBid: data.bid_amount,
          highestBidder: data.bidder,
          updatedAtLedger: ledgerSequence,
        }
      });
      if (count === 0) console.warn(`BID_PLACED: auction ${listingId} not found at ledger ${ledgerSequence}`);
      break;
    }

    case 'AUCTION_RESOLVED': {
      const { count } = await db.auction.updateMany({
        where: { auctionId: listingId },
        data: {
          status: 'Finalized',
          highestBid: data.amount,
          highestBidder: data.winner || null,
          updatedAtLedger: ledgerSequence,
        }
      });
      if (count === 0) console.error(`AUCTION_RESOLVED: auction ${listingId} not found — resolution not recorded at ledger ${ledgerSequence}`);
      break;
    }

    case 'AUCTION_CANCELLED': {
      const { count } = await db.auction.updateMany({
        where: { auctionId: listingId },
        data: {
          status: 'Cancelled',
          updatedAtLedger: ledgerSequence,
        },
      });
      if (count === 0) console.warn(`AUCTION_CANCELLED: auction ${listingId} not found at ledger ${ledgerSequence}`);
      break;
    }

    case 'OFFER_MADE': {
      await db.offer.upsert({
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
      await db.offer.update({
        where: { offerId: BigInt(data.offer_id) },
        data: {
          status: 'Accepted',
          updatedAtLedger: ledgerSequence,
        }
      });
      const { count: listingCount } = await db.listing.updateMany({
        where: { listingId: BigInt(data.listing_id) },
        data: {
          status: 'Sold',
          owner: data.offerer,
          updatedAtLedger: ledgerSequence,
        }
      });
      if (listingCount === 0) console.error(`OFFER_ACCEPTED: listing ${data.listing_id} not found — offer ${data.offer_id} accepted but listing not updated at ledger ${ledgerSequence}`);
      break;
    }

    case 'OFFER_REJECTED': {
      await db.offer.update({
        where: { offerId: BigInt(data.offer_id) },
        data: {
          status: 'Rejected',
          updatedAtLedger: ledgerSequence,
        }
      });
      break;
    }

    case 'OFFER_WITHDRAWN': {
      await db.offer.update({
        where: { offerId: BigInt(data.offer_id) },
        data: {
          status: 'Withdrawn',
          updatedAtLedger: ledgerSequence,
        }
      });
      break;
    }

    case 'NFT_STAKED': {
      const tokenAddress = data.token_address?.toString() || data.token_address || '';
      const tokenId = BigInt(data.token_id ?? 0);
      const collection = data.collection?.toString() || '';
      const stakedAt = data.timestamp ? new Date(Number(data.timestamp) * 1000) : new Date();

      await db.stakedNFT.upsert({
        where: {
          owner_tokenAddress_tokenId: {
            owner: actor,
            tokenAddress,
            tokenId,
          },
        },
        create: {
          owner: actor,
          tokenAddress,
          tokenId,
          collection,
          stakedAt,
          status: 'Active',
          rewardsEarned: '0',
          createdAtLedger: ledgerSequence,
          updatedAtLedger: ledgerSequence,
        },
        update: {
          status: 'Active',
          stakedAt,
          updatedAtLedger: ledgerSequence,
        }
      });
      break;
    }

    case 'NFT_UNSTAKED': {
      const tokenAddr = data.token_address?.toString() || data.token_address || '';
      const tId = BigInt(data.token_id ?? 0);

      await db.stakedNFT.updateMany({
        where: {
          owner: actor,
          tokenAddress: tokenAddr,
          tokenId: tId,
        },
        data: {
          status: 'Unstaked',
          updatedAtLedger: ledgerSequence,
        }
      });
      break;
    }

    case 'REWARDS_CLAIMED': {
      await db.stakedNFT.updateMany({
        where: { owner: actor, status: 'Active' },
        data: {
          rewardsEarned: { increment: data.amount?.toString() || '0' },
          updatedAtLedger: ledgerSequence,
        }
      });
      break;
    }
  }

  // Broadcast to any connected SSE clients after the DB write is complete.
  if (!tx) emitSSEEvent(event);
}
