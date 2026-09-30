import {
  rpc,
  Contract,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  scValToNative,
  Keypair,
  Account,
} from "@stellar/stellar-sdk";
import prisma from "./db.js";
import { emitSSEEvent } from "./api/routes.js";
import dotenv from "dotenv";
import {
  latestLedgerProcessedGauge,
  networkLatestLedgerGauge,
  syncLatencyGauge,
} from "./metrics.js";
import { collectMarketplaceEvents, MAX_LEDGER_WINDOW } from "./event-sync.js";
import { resolveMetadataCategory } from "./ipfs.js";
import redis from "./redis.js";

dotenv.config();

const RPC_URL =
  process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.MARKETPLACE_CONTRACT_ID || "";
const LAUNCHPAD_CONTRACT_ID = process.env.LAUNCHPAD_CONTRACT_ID || "";
const STAKING_CONTRACT_ID = process.env.STAKING_CONTRACT_ID || "";
const POLL_INTERVAL = parseInt(process.env.POLL_INTERVAL_MS || "5000");

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
  return [CONTRACT_ID, LAUNCHPAD_CONTRACT_ID, STAKING_CONTRACT_ID].filter(
    Boolean,
  );
}

function updateSyncMetrics(
  processedLedger: number,
  networkLatestLedger: number,
) {
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
      console.error("[Shutdown] Graceful shutdown failed:", err);
      process.exit(1);
    });
  };
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  process.on("SIGINT", () => onSignal("SIGINT"));
}

async function gracefulShutdown() {
  console.log("[Shutdown] Closing resources: Prisma + Redis");
  const cleanup = Promise.allSettled([
    prisma.$disconnect(),
    // redis may not be connected in some test environments
    redis && typeof redis.disconnect === "function"
      ? redis.disconnect()
      : Promise.resolve(),
  ]);

  // Timeout fallback: force exit if cleanup hangs
  try {
    await Promise.race([
      cleanup,
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error("shutdown timeout")), 10000),
      ),
    ]);
    console.log("[Shutdown] Cleanup complete, exiting");
    process.exit(0);
  } catch (err) {
    console.error("[Shutdown] Cleanup timed out or errored:", err);
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
  if (!err || typeof err !== "object") return false;
  const e = err as Record<string, unknown>;
  return (
    e["code"] === -32600 ||
    (typeof e["message"] === "string" &&
      (e["message"] as string).includes("start ledger must be between"))
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

    // Find listings whose state changed after the safe checkpoint
    // These may have corrupted fields (price, owner, etc.) from rolled-back transactions
    const dirtyListings = await tx.listing.findMany({
      where: { updatedAtLedger: { gt: safeAtLedger } },
      select: { listingId: true },
    });

    // Fetch canonical state from the contract for each dirty listing
    for (const { listingId } of dirtyListings) {
      try {
        const chainListing = await fetchListingFromChain(listingId);
        if (chainListing && chainListing.artist) {
          // Update with canonical on-chain state
          await tx.listing.update({
            where: { listingId },
            data: {
              artist: chainListing.artist.toString(),
              owner: chainListing.owner ? chainListing.owner.toString() : null,
              price: chainListing.price.toString(),
              currency: chainListing.currency.toString(),
              collection: chainListing.collection.toString(),
              nftTokenId: BigInt(chainListing.token_id),
              token: chainListing.token.toString(),
              status: chainListing.owner ? "Sold" : "Active",
              recipients: chainListing.recipients.map((r: any) => ({
                address: r.address.toString(),
                percentage: Number(r.percentage),
              })),
              updatedAtLedger: safeAtLedger,
            },
          });
          console.log(
            `[Reorg] Reverted listing ${listingId} to canonical on-chain state`,
          );
        } else {
          // Listing doesn't exist on chain or is invalid — mark as Cancelled
          await tx.listing.update({
            where: { listingId },
            data: { status: "Cancelled", updatedAtLedger: safeAtLedger },
          });
          console.warn(
            `[Reorg] Listing ${listingId} not found on chain — marked as Cancelled`,
          );
        }
      } catch (err) {
        // On error, conservatively mark as Cancelled to prevent corrupted state
        console.error(
          `[Reorg] Failed to fetch listing ${listingId} from chain:`,
          err,
        );
        await tx.listing.update({
          where: { listingId },
          data: { status: "Cancelled", updatedAtLedger: safeAtLedger },
        });
      }
    }

    // Handle auctions that were updated after the safe checkpoint
    const dirtyAuctions = await tx.auction.findMany({
      where: { updatedAtLedger: { gt: safeAtLedger } },
      select: { auctionId: true },
    });

    for (const { auctionId } of dirtyAuctions) {
      try {
        const chainAuction = await fetchAuctionFromChain(auctionId);
        if (chainAuction && chainAuction.creator) {
          await tx.auction.update({
            where: { auctionId },
            data: {
              creator: chainAuction.creator.toString(),
              collection: chainAuction.collection.toString(),
              nftTokenId: BigInt(chainAuction.token_id),
              token: chainAuction.token.toString(),
              reservePrice: chainAuction.reserve_price.toString(),
              highestBid: chainAuction.highest_bid?.toString() || "0",
              highestBidder: chainAuction.highest_bidder?.toString() || null,
              endTime: BigInt(chainAuction.end_time),
              status: "Active",
              recipients: chainAuction.recipients.map((r: any) => ({
                address: r.address.toString(),
                percentage: Number(r.percentage),
              })),
              updatedAtLedger: safeAtLedger,
            },
          });
          console.log(
            `[Reorg] Reverted auction ${auctionId} to canonical on-chain state`,
          );
        } else {
          await tx.auction.update({
            where: { auctionId },
            data: { status: "Cancelled", updatedAtLedger: safeAtLedger },
          });
          console.warn(
            `[Reorg] Auction ${auctionId} not found on chain — marked as Cancelled`,
          );
        }
      } catch (err) {
        console.error(
          `[Reorg] Failed to fetch auction ${auctionId} from chain:`,
          err,
        );
        await tx.auction.update({
          where: { auctionId },
          data: { status: "Cancelled", updatedAtLedger: safeAtLedger },
        });
      }
    }

    // Handle offers that were updated after the safe checkpoint
    // Offers are more complex — delete offers created after safe ledger
    await tx.offer.deleteMany({
      where: { createdAtLedger: { gt: safeAtLedger } },
    });

    // Revert updated offers back to Pending status (conservative approach)
    await tx.offer.updateMany({
      where: { updatedAtLedger: { gt: safeAtLedger } },
      data: { status: "Pending", updatedAtLedger: safeAtLedger },
    });

    // Reset collections deployed after the safe checkpoint
    await tx.collection.deleteMany({
      where: { deployedAtLedger: { gt: safeAtLedger } },
    });

    // Reset staked NFTs updated after the safe checkpoint
    await tx.stakedNFT.deleteMany({
      where: { createdAtLedger: { gt: safeAtLedger } },
    });

    await tx.stakedNFT.updateMany({
      where: { updatedAtLedger: { gt: safeAtLedger } },
      data: { status: "Active", updatedAtLedger: safeAtLedger },
    });

    // Reset lending listings and positions created after safe checkpoint
    await tx.lendingListing.deleteMany({
      where: { createdAtLedger: { gt: safeAtLedger } },
    });

    await tx.lendingPosition.deleteMany({
      where: { createdAtLedger: { gt: safeAtLedger } },
    });

    await tx.whitelistedCurrency.deleteMany({
      where: { addedAtLedger: { gt: safeAtLedger } },
    });

    // Reset the sync cursor
    await tx.syncState.update({
      where: { id: 1 },
      data: { lastLedger: safeAtLedger, lastLedgerHash: null },
    });
  });

  // Invalidate cached data that may be stale after the rollback
  if (redis && redis.isReady) {
    try {
      await redis.flushDb();
      console.log("[Reorg] Redis cache invalidated after rollback");
    } catch (err) {
      console.warn("[Reorg] Failed to invalidate Redis cache:", err);
    }
  }

  console.log(
    `[Reorg] Rollback complete. Resuming from ledger ${safeAtLedger + 1}`,
  );
}

/** SyncState fields for a ledger advance; omits hash when fetch failed so we keep the prior checkpoint. */
export function buildSyncStateLedgerData(
  lastLedger: number,
  ledgerHash: string | null,
): { lastLedger: number; lastLedgerHash?: string } {
  if (ledgerHash !== null) {
    return { lastLedger, lastLedgerHash: ledgerHash };
  }
  return { lastLedger };
}

export async function validateHashContinuity(
  syncState: { lastLedger: number; lastLedgerHash: string | null },
  rpcServer: rpc.Server,
): Promise<boolean> {
  // No stored hash (initial sync or prior hash fetch failure) — cannot detect re-org.
  if (syncState.lastLedger > 0 && syncState.lastLedgerHash) {
    try {
      const ledgersRes = await rpcServer.getLedgers({
        startLedger: syncState.lastLedger,
        pagination: { limit: 1 },
      });
      if (ledgersRes.ledgers && ledgersRes.ledgers.length > 0) {
        const networkLedger = ledgersRes.ledgers[0];
        if (networkLedger.hash !== syncState.lastLedgerHash) {
          console.warn(
            `Chain re-org detected at ledger ${syncState.lastLedger}! DB hash: ${syncState.lastLedgerHash}, Network hash: ${networkLedger.hash}`,
          );
          const toLedger = Math.max(0, syncState.lastLedger - 1);
          await revertLedgers(toLedger);
          return false;
        }
      }
    } catch (err) {
      console.error(
        `Error validating ledger hash continuity at ledger ${syncState.lastLedger}:`,
        err,
      );
    }
  }
  return true;
}

export async function startPolling() {
  const contractIds = getContractIds();
  if (contractIds.length === 0) {
    throw new Error(
      "At least one of MARKETPLACE_CONTRACT_ID or LAUNCHPAD_CONTRACT_ID must be set",
    );
  }

  console.log(
    `Starting indexer poller for contract(s): ${contractIds.join(", ")}`,
  );

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
        console.error({ msg: "Failed to fetch latest ledger", err });
        throw err;
      }

      networkLatestLedgerGauge.set(networkLatestLedger);

      // Stay a few ledgers behind the tip so all load-balancer nodes have
      // fully committed these ledgers before we request them.
      const effectiveLatestLedger = Math.max(
        0,
        networkLatestLedger - LEDGER_LAG_BUFFER,
      );

      if (
        syncState.lastLedger > 0 &&
        effectiveLatestLedger < syncState.lastLedger
      ) {
        // The RPC appears to be lagging behind our indexed state.  This is a
        // transient load-balancer condition, NOT a chain re-org — real re-orgs
        // are detected below via hash comparison.  Skip this poll iteration.
        console.warn({
          msg: "Effective latest ledger behind indexed state — possible RPC lag, skipping poll",
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
          msg: "Skipping ledger gap outside the live RPC window",
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
      const decodedEvents = await collectMarketplaceEvents(
        server,
        contractIds,
        startLedger,
        effectiveLatestLedger,
      );

      let latestHash: string | null = null;
      if (decodedEvents.length > 0) {
        const maxLedger = Math.max(
          ...decodedEvents.map((event) => event.ledgerSequence),
        );
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

        const { updatedState, newEvents } = await prisma.$transaction(
          async (tx) => {
            const toInsert = await applyDecodedEvents(decodedEvents, tx);
            const updated = await tx.syncState.update({
              where: { id: 1 },
              data: buildSyncStateLedgerData(maxLedger, latestHash),
            });

            return { updatedState: updated, newEvents: toInsert };
          },
        );

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
          console.error(
            `Failed to fetch hash for latest network ledger ${effectiveLatestLedger}:`,
            err,
          );
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
          msg: "RPC out-of-bounds error (-32600) — skipping poll cycle, no DB rollback",
          error: error instanceof Error ? error.message : String(error),
        });
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
        continue;
      }

      consecutiveErrors += 1;
      const backoff = Math.min(
        BASE_BACKOFF_MS * Math.pow(2, consecutiveErrors - 1),
        MAX_BACKOFF_MS,
      );
      console.error({
        msg: "Error in polling loop",
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

async function fetchListingFromChain(listingId: bigint): Promise<any | null> {
  if (!CONTRACT_ID) return null;
  try {
    const rpcServer = new rpc.Server(RPC_URL, {
      allowHttp: RPC_URL.startsWith("http://"),
    });
    const contract = new Contract(CONTRACT_ID);
    const dummy = Keypair.random();
    const account = await rpcServer
      .getAccount(dummy.publicKey())
      .catch(() => new Account(dummy.publicKey(), "0"));
    const tx = new TransactionBuilder(account, {
      fee: "10000",
      networkPassphrase:
        process.env.STELLAR_NETWORK_PASSPHRASE ||
        "Test SDF Network ; September 2015",
    })
      .addOperation(
        contract.call(
          "get_listing",
          nativeToScVal(Number(listingId), { type: "u64" }),
        ),
      )
      .setTimeout(30)
      .build();

    const simResult = await rpcServer.simulateTransaction(tx);
    if (rpc.Api.isSimulationSuccess(simResult)) {
      const retVal = simResult.result?.retval;
      if (retVal) {
        return scValToNative(retVal);
      }
    }
  } catch (err) {
    console.error(`Failed to fetch listing ${listingId} from chain:`, err);
  }
  return null;
}

async function fetchAuctionFromChain(auctionId: bigint): Promise<any | null> {
  if (!CONTRACT_ID) return null;
  try {
    const rpcServer = new rpc.Server(RPC_URL, {
      allowHttp: RPC_URL.startsWith("http://"),
    });
    const contract = new Contract(CONTRACT_ID);
    const dummy = Keypair.random();
    const account = await rpcServer
      .getAccount(dummy.publicKey())
      .catch(() => new Account(dummy.publicKey(), "0"));
    const tx = new TransactionBuilder(account, {
      fee: "10000",
      networkPassphrase:
        process.env.STELLAR_NETWORK_PASSPHRASE ||
        "Test SDF Network ; September 2015",
    })
      .addOperation(
        contract.call(
          "get_auction",
          nativeToScVal(Number(auctionId), { type: "u64" }),
        ),
      )
      .setTimeout(30)
      .build();

    const simResult = await rpcServer.simulateTransaction(tx);
    if (rpc.Api.isSimulationSuccess(simResult)) {
      const retVal = simResult.result?.retval;
      if (retVal) {
        return scValToNative(retVal);
      }
    }
  } catch (err) {
    console.error(`Failed to fetch auction ${auctionId} from chain:`, err);
  }
  return null;
}

async function fetchTokenUri(
  collectionId: string,
  tokenId: bigint,
): Promise<string | null> {
  try {
    const rpcServer = new rpc.Server(RPC_URL, { allowHttp: false });
    const contract = new Contract(collectionId);
    const dummy = Keypair.random();
    const account = await rpcServer
      .getAccount(dummy.publicKey())
      .catch(() => new Account(dummy.publicKey(), "0"));
    const tx = new TransactionBuilder(account, {
      fee: "10000",
      networkPassphrase:
        process.env.STELLAR_NETWORK_PASSPHRASE ||
        "Test SDF Network ; September 2015",
    })
      .addOperation(
        contract.call(
          "token_uri",
          nativeToScVal(Number(tokenId), { type: "u64" }),
        ),
      )
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
    console.error(
      `Failed to fetch token URI for collection ${collectionId} token ${tokenId}:`,
      err,
    );
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
    existing.map(
      (event: any) =>
        `${event.listingId ?? "null"}|${event.eventType}|${event.ledgerSequence}`,
    ),
  );

  const toInsert = decodedEvents.filter(
    (event: any) =>
      !existingSet.has(
        `${event.listingId ?? "null"}|${event.eventType}|${event.ledgerSequence}`,
      ),
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
  if (
    eventType === "DEPLOY_NORMAL_721" ||
    eventType === "DEPLOY_NORMAL_1155" ||
    eventType === "DEPLOY_LAZY_721" ||
    eventType === "DEPLOY_LAZY_1155"
  ) {
    const kindMap: Record<string, string> = {
      DEPLOY_NORMAL_721: "normal_721",
      DEPLOY_NORMAL_1155: "normal_1155",
      DEPLOY_LAZY_721: "lazy_721",
      DEPLOY_LAZY_1155: "lazy_1155",
    };
    const rawData = Array.isArray(data) ? data : [];
    const creatorAddr = rawData[0]?.toString() || actor;
    const contractAddr = rawData[1]?.toString() || "";
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

  // Handle currency whitelist events — these carry no listingId
  if (
    eventType === "CURRENCY_WHITELISTED" ||
    eventType === "CurrencyWhitelisted"
  ) {
    const address =
      data.currency?.toString() ||
      data.address?.toString() ||
      data.token?.toString() ||
      "";
    if (address) {
      await db.whitelistedCurrency.upsert({
        where: { address },
        create: {
          address,
          symbol: data.symbol?.toString() || null,
          name: data.name?.toString() || null,
          decimals: data.decimals ? Number(data.decimals) : 7,
          enabled: true,
          addedAtLedger: ledgerSequence,
          updatedAtLedger: ledgerSequence,
        },
        update: {
          enabled: true,
          symbol: data.symbol?.toString() || undefined,
          updatedAtLedger: ledgerSequence,
        },
      });
    }
    if (!tx) emitSSEEvent(event);
    return;
  }

  if (eventType === "CURRENCY_REMOVED" || eventType === "CurrencyRemoved") {
    const address =
      data.currency?.toString() ||
      data.address?.toString() ||
      data.token?.toString() ||
      "";
    if (address) {
      await db.whitelistedCurrency.updateMany({
        where: { address },
        data: {
          enabled: false,
          updatedAtLedger: ledgerSequence,
        },
      });
    }
    if (!tx) emitSSEEvent(event);
    return;
  }

  // Update Listing/Position state based on event type
  // Lending position liquidation carries a position_id mapped to listingId by the parser,
  // so we guard here for all remaining event types that require an entity id.
  if (!listingId) return;

  switch (eventType) {
    case "LISTING_CREATED": {
      let chainListing = await fetchListingFromChain(listingId);
      if (chainListing && !chainListing.artist) {
        chainListing = null;
      }

      const artist = chainListing
        ? chainListing.artist.toString()
        : data.artist;
      const price = chainListing ? chainListing.price.toString() : data.price;
      const currency = chainListing
        ? chainListing.currency.toString()
        : data.currency;
      const collection = chainListing
        ? chainListing.collection.toString()
        : data.collection;
      const nftTokenId = chainListing
        ? BigInt(chainListing.token_id)
        : BigInt(data.token_id);
      const token = chainListing
        ? chainListing.token.toString()
        : data.token || "";

      const recipients = chainListing
        ? chainListing.recipients.map((r: any) => ({
            address: r.address.toString(),
            percentage: Number(r.percentage),
          }))
        : (data.recipients || []).map((r: any) => ({
            address: r.address?.toString() || r.address,
            percentage: Number(r.percentage),
          }));

      const metadataCid = await fetchTokenUri(collection, nftTokenId);
      const category = await resolveMetadataCategory(metadataCid);

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
          category,
          status: "Active",
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
          category,
          status: "Active",
          recipients,
          updatedAtLedger: ledgerSequence,
        },
      });
      break;
    }

    case "LISTING_UPDATED": {
      const { count } = await db.listing.updateMany({
        where: { listingId },
        data: {
          price: data.new_price,
          collection: data.collection,
          nftTokenId: BigInt(data.token_id || 0),
          updatedAtLedger: ledgerSequence,
        },
      });
      if (count === 0)
        console.warn(
          `LISTING_UPDATED: listing ${listingId} not found at ledger ${ledgerSequence}`,
        );
      break;
    }

    case "ARTWORK_SOLD": {
      const { count } = await db.listing.updateMany({
        where: { listingId },
        data: {
          status: "Sold",
          owner: data.buyer,
          updatedAtLedger: ledgerSequence,
        },
      });
      if (count === 0)
        console.error(
          `ARTWORK_SOLD: listing ${listingId} not found — sale not recorded at ledger ${ledgerSequence}`,
        );
      break;
    }

    case "LISTING_CANCELLED": {
      const { count } = await db.listing.updateMany({
        where: { listingId },
        data: {
          status: "Cancelled",
          updatedAtLedger: ledgerSequence,
        },
      });
      if (count === 0)
        console.warn(
          `LISTING_CANCELLED: listing ${listingId} not found at ledger ${ledgerSequence}`,
        );
      break;
    }

    case "AUCTION_CREATED": {
      let chainAuction = await fetchAuctionFromChain(listingId);
      if (chainAuction && !chainAuction.creator) {
        chainAuction = null;
      }

      const creator = chainAuction
        ? chainAuction.creator.toString()
        : data.creator;
      const reservePrice = chainAuction
        ? chainAuction.reserve_price.toString()
        : data.reserve_price || "0";
      const token = chainAuction
        ? chainAuction.token.toString()
        : data.token || "";
      const endTime = chainAuction
        ? BigInt(chainAuction.end_time)
        : BigInt(data.end_time || 0);
      const collection = chainAuction
        ? chainAuction.collection.toString()
        : data.collection;
      const nftTokenId = chainAuction
        ? BigInt(chainAuction.token_id)
        : BigInt(data.token_id || 0);
      const recipients = chainAuction
        ? chainAuction.recipients.map((r: any) => ({
            address: r.address.toString(),
            percentage: Number(r.percentage),
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
          highestBid: "0",
          highestBidder: null,
          endTime,
          status: "Active",
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
          status: "Active",
          recipients,
          updatedAtLedger: ledgerSequence,
        },
      });
      break;
    }

    case "BID_PLACED": {
      const { count } = await db.auction.updateMany({
        where: { auctionId: listingId },
        data: {
          highestBid: data.bid_amount,
          highestBidder: data.bidder,
          updatedAtLedger: ledgerSequence,
        },
      });
      if (count === 0)
        console.warn(
          `BID_PLACED: auction ${listingId} not found at ledger ${ledgerSequence}`,
        );
      break;
    }

    case "AUCTION_RESOLVED": {
      const { count } = await db.auction.updateMany({
        where: { auctionId: listingId },
        data: {
          status: "Finalized",
          highestBid: data.amount,
          highestBidder: data.winner || null,
          updatedAtLedger: ledgerSequence,
        },
      });
      if (count === 0)
        console.error(
          `AUCTION_RESOLVED: auction ${listingId} not found — resolution not recorded at ledger ${ledgerSequence}`,
        );
      break;
    }

    case "AUCTION_CANCELLED": {
      const { count } = await db.auction.updateMany({
        where: { auctionId: listingId },
        data: {
          status: "Cancelled",
          updatedAtLedger: ledgerSequence,
        },
      });
      if (count === 0)
        console.warn(
          `AUCTION_CANCELLED: auction ${listingId} not found at ledger ${ledgerSequence}`,
        );
      break;
    }

    case "OFFER_MADE": {
      await db.offer.upsert({
        where: { offerId: BigInt(data.offer_id) },
        create: {
          offerId: BigInt(data.offer_id),
          listingId: BigInt(data.listing_id),
          offerer: data.offerer,
          amount: data.amount,
          token: data.token,
          status: "Pending",
          createdAtLedger: ledgerSequence,
          updatedAtLedger: ledgerSequence,
        },
        update: {
          listingId: BigInt(data.listing_id),
          offerer: data.offerer,
          amount: data.amount,
          token: data.token,
          status: "Pending",
          updatedAtLedger: ledgerSequence,
        },
      });
      break;
    }

    case "OFFER_ACCEPTED": {
      await db.offer.update({
        where: { offerId: BigInt(data.offer_id) },
        data: {
          status: "Accepted",
          updatedAtLedger: ledgerSequence,
        },
      });
      const { count: listingCount } = await db.listing.updateMany({
        where: { listingId: BigInt(data.listing_id) },
        data: {
          status: "Sold",
          owner: data.offerer,
          updatedAtLedger: ledgerSequence,
        },
      });
      if (listingCount === 0)
        console.error(
          `OFFER_ACCEPTED: listing ${data.listing_id} not found — offer ${data.offer_id} accepted but listing not updated at ledger ${ledgerSequence}`,
        );
      break;
    }

    case "OFFER_REJECTED": {
      await db.offer.update({
        where: { offerId: BigInt(data.offer_id) },
        data: {
          status: "Rejected",
          updatedAtLedger: ledgerSequence,
        },
      });
      break;
    }

    case "OFFER_WITHDRAWN": {
      await db.offer.update({
        where: { offerId: BigInt(data.offer_id) },
        data: {
          status: "Withdrawn",
          updatedAtLedger: ledgerSequence,
        },
      });
      break;
    }

    case "NFT_STAKED": {
      const tokenAddress =
        data.token_address?.toString() || data.token_address || "";
      const tokenId = BigInt(data.token_id ?? 0);
      const collection = data.collection?.toString() || "";
      const stakedAt = data.timestamp
        ? new Date(Number(data.timestamp) * 1000)
        : new Date();

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
          status: "Active",
          rewardsEarned: "0",
          createdAtLedger: ledgerSequence,
          updatedAtLedger: ledgerSequence,
        },
        update: {
          status: "Active",
          stakedAt,
          updatedAtLedger: ledgerSequence,
        },
      });
      break;
    }

    case "NFT_UNSTAKED": {
      const tokenAddr =
        data.token_address?.toString() || data.token_address || "";
      const tId = BigInt(data.token_id ?? 0);

      await db.stakedNFT.updateMany({
        where: {
          owner: actor,
          tokenAddress: tokenAddr,
          tokenId: tId,
        },
        data: {
          status: "Unstaked",
          updatedAtLedger: ledgerSequence,
        },
      });
      break;
    }

    case "REWARDS_CLAIMED": {
      await db.stakedNFT.updateMany({
        where: { owner: actor, status: "Active" },
        data: {
          rewardsEarned: { increment: data.amount?.toString() || "0" },
          updatedAtLedger: ledgerSequence,
        },
      });
      break;
    }

    // ── Lending event handlers ────────────────────────────────────────────────

    case "LISTING_CANCELLED": {
      const { count } = await db.lendingListing.updateMany({
        where: { listingId: BigInt(listingId) },
        data: {
          status: "Cancelled",
          updatedAtLedger: ledgerSequence,
        },
      });
      if (count === 0) {
        console.warn(
          `LISTING_CANCELLED: lending listing ${listingId} not found at ledger ${ledgerSequence}`,
        );
      }
      break;
    }

    case "POSITION_LIQUIDATED":
    case "Liquidated": {
      const posId = BigInt(data.position_id ?? listingId ?? 0);
      const liquidator = data.liquidator?.toString() || actor;
      const liquidatorBounty =
        data.liquidator_bounty?.toString() ||
        data.liquidatorBounty?.toString() ||
        "0";
      const platformFee =
        data.platform_fee?.toString() || data.platformFee?.toString() || "0";
      const lenderPayout =
        data.lender_payout?.toString() || data.lenderPayout?.toString() || "0";
      const borrowerRefund =
        data.borrower_refund?.toString() ||
        data.borrowerRefund?.toString() ||
        "0";

      const { count } = await db.lendingPosition.updateMany({
        where: { positionId: posId },
        data: {
          status: "Liquidated",
          liquidator,
          liquidatorBounty,
          platformFee,
          lenderPayout,
          borrowerRefund,
          updatedAtLedger: ledgerSequence,
        },
      });
      if (count === 0) {
        console.warn(
          `POSITION_LIQUIDATED: position ${posId} not found at ledger ${ledgerSequence}`,
        );
      }
      break;
    }

    case "BORROW": {
      // When a borrower accepts terms, create LendingPosition and mark parent LendingListing as Filled
      const positionId = BigInt(data.position_id ?? 0);
      const parentListingId = BigInt(data.listing_id ?? listingId ?? 0);
      const borrowerAddr = data.borrower?.toString() || actor;
      const collateralAmount = data.collateral_amount?.toString() || "0";

      // Fetch parent listing to get lender and NFT details
      const parentListing = await db.lendingListing.findUnique({
        where: { listingId: parentListingId },
      });

      if (!parentListing) {
        console.error(
          `BORROW: parent listing ${parentListingId} not found at ledger ${ledgerSequence}`,
        );
        break;
      }

      // Insert LendingPosition and update LendingListing in a single transaction
      await db.$transaction([
        db.lendingPosition.create({
          data: {
            positionId,
            listingId: parentListingId,
            borrower: borrowerAddr,
            lender: parentListing.lender,
            nftContract: parentListing.nftContract,
            tokenId: parentListing.tokenId,
            declaredPriceUsd: parentListing.declaredPriceUsd,
            collateralCurrency: data.collateral_currency?.toString() || "",
            collateralAmount,
            interestScheduleBps: parentListing.interestScheduleBps,
            liquidationThresholdBps: parentListing.liquidationThresholdBps,
            startTime: BigInt(data.start_time ?? Date.now() / 1000),
            maxDurationSecs: BigInt(parentListing.maxDurationDays * 86400),
            status: "Active",
            createdAtLedger: ledgerSequence,
            updatedAtLedger: ledgerSequence,
          },
        }),
        db.lendingListing.update({
          where: { listingId: parentListingId },
          data: {
            status: "Filled",
            updatedAtLedger: ledgerSequence,
          },
        }),
      ]);

      console.log(
        `BORROW: created position ${positionId}, marked listing ${parentListingId} as Filled at ledger ${ledgerSequence}`,
      );
      break;
    }

    case "COLLATERAL_ADDED": {
      const posId = BigInt(data.position_id ?? listingId ?? 0);
      const addedAmount = data.amount?.toString() || "0";
      const newTotal = data.new_total?.toString();

      // Update collateral_amount idempotently based on ledger sequence
      const position = await db.lendingPosition.findUnique({
        where: { positionId: posId },
      });

      if (!position) {
        console.warn(
          `COLLATERAL_ADDED: position ${posId} not found at ledger ${ledgerSequence}`,
        );
        break;
      }

      // Only update if this ledger is newer than the last update (idempotent)
      if (ledgerSequence > position.updatedAtLedger) {
        await db.lendingPosition.update({
          where: { positionId: posId },
          data: {
            collateralAmount: newTotal || position.collateralAmount,
            updatedAtLedger: ledgerSequence,
          },
        });
        console.log(
          `COLLATERAL_ADDED: increased position ${posId} collateral by ${addedAmount} at ledger ${ledgerSequence}`,
        );
      } else {
        console.log(
          `COLLATERAL_ADDED: skipped stale update for position ${posId} at ledger ${ledgerSequence}`,
        );
      }
      break;
    }
    case "LENDING_LISTING_CREATED": {
      const id = BigInt(data.listing_id ?? listingId ?? 0);
      const lender = data.lender?.toString() || actor;
      const nftContract =
        data.nft_contract?.toString() || data.collection?.toString() || "";
      const tokenId = BigInt(data.token_id ?? 0);
      const declaredPriceUsd = data.declared_price_usd?.toString() || "0";
      const interestScheduleBps = data.interest_schedule_bps || [];
      const maxDurationDays = Number(data.max_duration_days ?? 0);
      const minCollateralBufferBps = Number(
        data.min_collateral_buffer_bps ?? 0,
      );
      const liquidationThresholdBps = Number(
        data.liquidation_threshold_bps ?? 0,
      );

      await db.lendingListing.upsert({
        where: { id },
        create: {
          id,
          lender,
          nftContract,
          collectionAddress: nftContract || null,
          tokenId,
          declaredPriceUsd,
          interestScheduleBps,
          maxDurationDays,
          minCollateralBufferBps,
          liquidationThresholdBps,
          status: "Open",
          createdAtLedger: ledgerSequence,
          updatedAtLedger: ledgerSequence,
        },
        update: {
          lender,
          nftContract,
          collectionAddress: nftContract || null,
          tokenId,
          declaredPriceUsd,
          interestScheduleBps,
          maxDurationDays,
          minCollateralBufferBps,
          liquidationThresholdBps,
          status: "Open",
          updatedAtLedger: ledgerSequence,
        },
      });
      break;
    }

    case "LENDING_LISTING_CANCELLED": {
      const id = BigInt(data.listing_id ?? listingId ?? 0);
      await db.lendingListing.updateMany({
        where: { id },
        data: {
          status: "Cancelled",
          updatedAtLedger: ledgerSequence,
        },
      });
      break;
    }

    case "POSITION_OPENED": {
      const id = BigInt(data.position_id ?? listingId ?? 0);
      const lId = BigInt(data.listing_id ?? 0);
      const borrower = data.borrower?.toString() || actor;
      const lender = data.lender?.toString() || "";
      const nftContract = data.nft_contract?.toString() || "";
      const tokenId = BigInt(data.token_id ?? 0);
      const declaredPriceUsd = data.declared_price_usd?.toString() || "0";
      const collateralCurrency = data.collateral_currency?.toString() || "";
      const collateralAmount = data.collateral_amount?.toString() || "0";
      const interestScheduleBps = data.interest_schedule_bps || [];
      const liquidationThresholdBps = Number(
        data.liquidation_threshold_bps ?? 0,
      );
      const startTime = BigInt(data.start_time ?? 0);
      const maxDurationSecs = BigInt(data.max_duration_secs ?? 0);

      await db.lendingPosition.upsert({
        where: { id },
        create: {
          id,
          listingId: lId,
          lender,
          borrower,
          nftContract,
          tokenId,
          declaredPriceUsd,
          collateralCurrency,
          collateralAmount,
          interestScheduleBps,
          liquidationThresholdBps,
          startTime,
          maxDurationSecs,
          status: "Active",
          createdAtLedger: ledgerSequence,
          updatedAtLedger: ledgerSequence,
        },
        update: {
          listingId: lId,
          lender,
          borrower,
          nftContract,
          tokenId,
          declaredPriceUsd,
          collateralCurrency,
          collateralAmount,
          interestScheduleBps,
          liquidationThresholdBps,
          startTime,
          maxDurationSecs,
          status: "Active",
          updatedAtLedger: ledgerSequence,
        },
      });

      if (lId > 0n) {
        await db.lendingListing.updateMany({
          where: { id: lId },
          data: { status: "Filled", updatedAtLedger: ledgerSequence },
        });
      }
      break;
    }

    case "POSITION_RETURNED": {
      const posId = BigInt(data.position_id ?? listingId ?? 0);
      const platformFee =
        data.platform_fee?.toString() || data.platformFee?.toString() || "0";
      const borrowerRefund =
        data.borrower_refund?.toString() ||
        data.borrowerRefund?.toString() ||
        "0";

      await db.lendingPosition.updateMany({
        where: { id: posId },
        data: {
          status: "Returned",
          platformFee,
          borrowerRefund,
          updatedAtLedger: ledgerSequence,
        },
      });
      break;
    }

    case 'POSITION_CLOSED': {
      const { count } = await db.lendingPosition.updateMany({
        where: { positionId: BigInt(data.position_id) },
        data: {
          status: 'Repaid',
          updatedAtLedger: ledgerSequence,
        },
      });
      if (count === 0) console.warn(`POSITION_CLOSED: position ${data.position_id} not found at ledger ${ledgerSequence}`);
      break;
    }

    case 'CONFIG_UPDATED': {
      await db.lendingConfig.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          platformFeeRate: data.platform_fee_rate ? BigInt(data.platform_fee_rate).toString() : '100',
          minHealthFactor: data.min_health_factor ? BigInt(data.min_health_factor).toString() : '150',
          liquidationThreshold: data.liquidation_threshold ? BigInt(data.liquidation_threshold).toString() : '120',
          updatedAtLedger: ledgerSequence,
        },
        update: {
          platformFeeRate: data.platform_fee_rate ? BigInt(data.platform_fee_rate).toString() : undefined,
          minHealthFactor: data.min_health_factor ? BigInt(data.min_health_factor).toString() : undefined,
          liquidationThreshold: data.liquidation_threshold ? BigInt(data.liquidation_threshold).toString() : undefined,
          updatedAtLedger: ledgerSequence,
        },
      });
      break;
    }
  }

  // Broadcast to any connected SSE clients after the DB write is complete.
  if (!tx) emitSSEEvent(event);
}
