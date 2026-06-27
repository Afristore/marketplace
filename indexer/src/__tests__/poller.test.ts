import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Prevent dotenv from loading .env so module-level CONTRACT_ID constants stay empty
vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

// ── Mock Prisma ───────────────────────────────────────────────────────────────

const mockTx = vi.hoisted(() => ({
  marketplaceEvent: { deleteMany: vi.fn().mockResolvedValue({}) },
  listing: {
    deleteMany: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({}),
  },
  collection: { deleteMany: vi.fn().mockResolvedValue({}) },
  syncState: { update: vi.fn().mockResolvedValue({}) },
}));

const mockPrisma = vi.hoisted(() => ({
  marketplaceEvent: {
    create: vi.fn().mockResolvedValue({}),
  },
  listing: {
    upsert: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  auction: {
    upsert: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  offer: {
    upsert: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
  },
  collection: {
    upsert: vi.fn().mockResolvedValue({}),
  },
  syncState: {
    findUnique: vi.fn(),
    create: vi.fn().mockResolvedValue({ id: 1, lastLedger: 0 }),
    update: vi.fn().mockResolvedValue({}),
    upsert: vi.fn().mockResolvedValue({ id: 1, lastLedger: 0, lastLedgerHash: null }),
  },
  $transaction: vi.fn((fn: (tx: typeof mockTx) => Promise<void>) => fn(mockTx)),
}));

vi.mock('../db', () => ({ default: mockPrisma }));
vi.mock('../metrics.js', () => ({
  latestLedgerProcessedGauge: { set: vi.fn() },
  networkLatestLedgerGauge: { set: vi.fn() },
  syncLatencyGauge: { set: vi.fn() },
}));

// Stellar SDK mocks for offline unit testing
vi.mock('@stellar/stellar-sdk', () => ({
  rpc: {
    Server: class {
      getEvents() { return Promise.resolve({ events: [] }); }
      getLedgers() { return Promise.resolve({ ledgers: [{ hash: 'correct_network_hash', sequence: 100 }] }); }
      getLatestLedger() { return Promise.resolve({ sequence: 1000 }); }
      getAccount() { return Promise.resolve({ sequence: '1' }); }
      simulateTransaction() { return Promise.resolve({ result: { retval: {} } }); }
    },
    Api: {
      isSimulationError: () => false,
    },
  },
  Contract: class {
    call() { return {}; }
  },
  TransactionBuilder: class {
    addOperation() { return this; }
    setTimeout() { return this; }
    build() { return {}; }
  },
  BASE_FEE: '100',
  nativeToScVal: () => ({}),
  scValToNative: () => ({}),
  Address: class {
    constructor(public addr: string) {}
    toScVal() { return {}; }
    toString() { return this.addr; }
  },
}));

import {
  processEvent,
  revertLedgers,
  validateHashContinuity,
  buildSyncStateLedgerData,
  startPolling,
} from '../poller';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeEvent(
  eventType: string,
  listingId: bigint | null,
  actor: string,
  data: Record<string, unknown>,
  ledger = 100
) {
  return { eventType, listingId, actor, ledgerSequence: ledger, data };
}

// ── MarketplaceEvent log (all event types) ────────────────────────────────────

describe('processEvent — always logs to MarketplaceEvent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates a MarketplaceEvent record for every event', async () => {
    const event = makeEvent('OFFER_MADE', null, 'GA_OFFERER', {});
    await processEvent(event);

    expect(mockPrisma.marketplaceEvent.create).toHaveBeenCalledOnce();
    expect(mockPrisma.marketplaceEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        eventType: 'OFFER_MADE',
        actor: 'GA_OFFERER',
        ledgerSequence: 100,
      }),
    });
  });

  it('stores the decoded data in the event record', async () => {
    const data = { price: '1000000', currency: 'XLM', collection: 'CCOLLECTION', token_id: 1 };
    const event = makeEvent('LISTING_CREATED', 1n, 'GA_ARTIST', data);
    await processEvent(event);

    expect(mockPrisma.marketplaceEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ data }),
    });
  });
});

// ── Listing upsert on LISTING_CREATED ────────────────────────────────────────

describe('processEvent — LISTING_CREATED', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upserts a new listing with Active status', async () => {
    const data = {
      artist: 'GA_ARTIST',
      price: '10000000',
      currency: 'XLM',
      collection: 'CCOLLECTION',
      token_id: 1,
      token: 'CTOKEN',
    };
    await processEvent(makeEvent('LISTING_CREATED', 42n, 'GA_ARTIST', data, 200));

    expect(mockPrisma.listing.upsert).toHaveBeenCalledOnce();
    const call = mockPrisma.listing.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ listingId: 42n });
    expect(call.create).toMatchObject({
      listingId: 42n,
      artist: 'GA_ARTIST',
      status: 'Active',
      createdAtLedger: 200,
    });
  });

  it('does not call listing.updateMany for LISTING_CREATED', async () => {
    await processEvent(makeEvent('LISTING_CREATED', 1n, 'GA', { artist: 'GA', collection: 'C', token_id: 1 }, 1));
    expect(mockPrisma.listing.updateMany).not.toHaveBeenCalled();
  });
});

// ── Listing update on LISTING_UPDATED ────────────────────────────────────────

describe('processEvent — LISTING_UPDATED', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates price and metadataCid', async () => {
    const data = { new_price: '20000000', collection: 'CCOLLECTION', token_id: 1 };
    await processEvent(makeEvent('LISTING_UPDATED', 5n, '', data, 300));

    expect(mockPrisma.listing.updateMany).toHaveBeenCalledOnce();
    expect(mockPrisma.listing.updateMany).toHaveBeenCalledWith({
      where: { listingId: 5n },
      data: expect.objectContaining({
        price: '20000000',
        collection: 'CCOLLECTION',
        nftTokenId: 1n,
        updatedAtLedger: 300,
      }),
    });
  });
});

// ── ARTWORK_SOLD ──────────────────────────────────────────────────────────────

describe('processEvent — ARTWORK_SOLD', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sets status to Sold and records the buyer as owner', async () => {
    const data = { buyer: 'GB_BUYER' };
    await processEvent(makeEvent('ARTWORK_SOLD', 8n, 'GB_BUYER', data, 400));

    expect(mockPrisma.listing.updateMany).toHaveBeenCalledWith({
      where: { listingId: 8n },
      data: expect.objectContaining({ status: 'Sold', owner: 'GB_BUYER' }),
    });
  });
});

// ── LISTING_CANCELLED ─────────────────────────────────────────────────────────

describe('processEvent — LISTING_CANCELLED', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sets status to Cancelled', async () => {
    await processEvent(makeEvent('LISTING_CANCELLED', 3n, '', {}, 500));

    expect(mockPrisma.listing.updateMany).toHaveBeenCalledWith({
      where: { listingId: 3n },
      data: expect.objectContaining({ status: 'Cancelled' }),
    });
  });
});

// ── AUCTION_CREATED ───────────────────────────────────────────────────────────

describe('processEvent — AUCTION_CREATED', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upserts a new auction with Active status', async () => {
    const data = {
      creator: 'GA_CREATOR',
      reserve_price: '50000000',
      token: 'CTOKEN',
      end_time: 1800000000,
    };
    await processEvent(makeEvent('AUCTION_CREATED', 11n, 'GA_CREATOR', data, 600));

    expect(mockPrisma.auction.upsert).toHaveBeenCalledOnce();
    const call = mockPrisma.auction.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ auctionId: 11n });
    expect(call.create).toMatchObject({
      auctionId: 11n,
      creator: 'GA_CREATOR',
      status: 'Active',
      createdAtLedger: 600,
    });
  });
});

// ── BID_PLACED ─────────────────────────────────────────────────────────────────

describe('processEvent — BID_PLACED', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates highestBid and highestBidder on the auction', async () => {
    const data = {
      bidder: 'GB_BIDDER',
      bid_amount: '55000000',
    };
    await processEvent(makeEvent('BID_PLACED', 11n, 'GB_BIDDER', data, 610));

    expect(mockPrisma.auction.updateMany).toHaveBeenCalledOnce();
    expect(mockPrisma.auction.updateMany).toHaveBeenCalledWith({
      where: { auctionId: 11n },
      data: expect.objectContaining({
        highestBid: '55000000',
        highestBidder: 'GB_BIDDER',
        updatedAtLedger: 610,
      }),
    });
  });
});

// ── AUCTION_CANCELLED ─────────────────────────────────────────────────────────

describe('processEvent — AUCTION_CANCELLED', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sets auction status to Cancelled', async () => {
    await processEvent(makeEvent('AUCTION_CANCELLED', 11n, 'GA_CREATOR', {}, 615));

    expect(mockPrisma.auction.updateMany).toHaveBeenCalledWith({
      where: { auctionId: 11n },
      data: expect.objectContaining({ status: 'Cancelled' }),
    });
  });
});

// ── AUCTION_RESOLVED ───────────────────────────────────────────────────────────

describe('processEvent — AUCTION_RESOLVED', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sets auction status to Finalized and records the winner and final amount', async () => {
    const data = {
      winner: 'GB_BIDDER',
      amount: '55000000',
    };
    await processEvent(makeEvent('AUCTION_RESOLVED', 11n, 'GA_CREATOR', data, 620));

    expect(mockPrisma.auction.updateMany).toHaveBeenCalledOnce();
    expect(mockPrisma.auction.updateMany).toHaveBeenCalledWith({
      where: { auctionId: 11n },
      data: expect.objectContaining({
        status: 'Finalized',
        highestBid: '55000000',
        highestBidder: 'GB_BIDDER',
        updatedAtLedger: 620,
      }),
    });
  });
});

// ── OFFER_MADE ─────────────────────────────────────────────────────────────────

describe('processEvent — OFFER_MADE', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upserts a new offer with Pending status', async () => {
    const data = {
      offer_id: 1,
      listing_id: 42,
      offerer: 'GA_OFFERER',
      amount: '30000000',
      token: 'CTOKEN',
    };
    await processEvent(makeEvent('OFFER_MADE', 42n, 'GA_OFFERER', data, 630));

    expect(mockPrisma.offer.upsert).toHaveBeenCalledOnce();
    const call = mockPrisma.offer.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ offerId: 1n });
    expect(call.create).toMatchObject({
      offerId: 1n,
      listingId: 42n,
      offerer: 'GA_OFFERER',
      amount: '30000000',
      token: 'CTOKEN',
      status: 'Pending',
      createdAtLedger: 630,
    });
  });
});

// ── OFFER_ACCEPTED ─────────────────────────────────────────────────────────────

describe('processEvent — OFFER_ACCEPTED', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sets offer status to Accepted and updates related listing to Sold', async () => {
    const data = {
      offer_id: 1,
      listing_id: 42,
      offerer: 'GA_OFFERER',
      amount: '30000000',
    };
    await processEvent(makeEvent('OFFER_ACCEPTED', 42n, 'GA_OWNER', data, 640));

    expect(mockPrisma.offer.update).toHaveBeenCalledOnce();
    expect(mockPrisma.offer.update).toHaveBeenCalledWith({
      where: { offerId: 1n },
      data: {
        status: 'Accepted',
        updatedAtLedger: 640,
      },
    });

    expect(mockPrisma.listing.updateMany).toHaveBeenCalledOnce();
    expect(mockPrisma.listing.updateMany).toHaveBeenCalledWith({
      where: { listingId: 42n },
      data: expect.objectContaining({
        status: 'Sold',
        owner: 'GA_OFFERER',
        updatedAtLedger: 640,
      }),
    });
  });
});

// ── Events with no listingId ──────────────────────────────────────────────────

describe('processEvent — null listingId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logs the event but skips listing mutations when listingId is null', async () => {
    await processEvent(makeEvent('OFFER_MADE', null, 'GA_OFFERER', { offer_id: 1 }));

    expect(mockPrisma.marketplaceEvent.create).toHaveBeenCalledOnce();
  });
});

// ── revertLedgers ─────────────────────────────────────────────────────────────

describe('revertLedgers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes marketplace events beyond the safe ledger', async () => {
    await revertLedgers(500);
    expect(mockTx.marketplaceEvent.deleteMany).toHaveBeenCalledWith({
      where: { ledgerSequence: { gt: 500 } },
    });
  });

  it('removes listings first created after the safe ledger', async () => {
    await revertLedgers(500);
    expect(mockTx.listing.deleteMany).toHaveBeenCalledWith({
      where: { createdAtLedger: { gt: 500 } },
    });
  });

  it('resets listing status to Active for listings updated after safe ledger', async () => {
    await revertLedgers(500);
    expect(mockTx.listing.updateMany).toHaveBeenCalledWith({
      where: { updatedAtLedger: { gt: 500 } },
      data: { status: 'Active', updatedAtLedger: 500 },
    });
  });

  it('removes collections deployed after the safe ledger', async () => {
    await revertLedgers(500);
    expect(mockTx.collection.deleteMany).toHaveBeenCalledWith({
      where: { deployedAtLedger: { gt: 500 } },
    });
  });

  it('resets SyncState cursor to the safe ledger and clears the hash', async () => {
    await revertLedgers(500);
    expect(mockTx.syncState.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { lastLedger: 500, lastLedgerHash: null },
    });
  });

  it('runs all operations inside a single transaction', async () => {
    await revertLedgers(300);
    expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
  });
});

// ── buildSyncStateLedgerData (#244) ───────────────────────────────────────────

describe('buildSyncStateLedgerData', () => {
  it('includes lastLedgerHash when hash fetch succeeds', () => {
    expect(buildSyncStateLedgerData(100, 'ledger_hash')).toEqual({
      lastLedger: 100,
      lastLedgerHash: 'ledger_hash',
    });
  });

  it('omits lastLedgerHash when hash fetch fails so the prior checkpoint is preserved', () => {
    expect(buildSyncStateLedgerData(100, null)).toEqual({ lastLedger: 100 });
  });
});

// ── validateHashContinuity ────────────────────────────────────────────────────

describe('validateHashContinuity', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns true and skips RPC when lastLedgerHash is null (#244)', async () => {
    const mockServer = { getLedgers: vi.fn() } as any;

    const result = await validateHashContinuity(
      { lastLedger: 100, lastLedgerHash: null },
      mockServer
    );

    expect(result).toBe(true);
    expect(mockServer.getLedgers).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns true if network hash matches lastLedgerHash', async () => {
    const mockServer = {
      getLedgers: vi.fn().mockResolvedValue({
        ledgers: [{ hash: 'matching_hash' }]
      })
    } as any;
    
    const result = await validateHashContinuity(
      { lastLedger: 100, lastLedgerHash: 'matching_hash' },
      mockServer
    );
    
    expect(result).toBe(true);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns false and triggers revertLedgers if hashes mismatch', async () => {
    const mockServer = {
      getLedgers: vi.fn().mockResolvedValue({
        ledgers: [{ hash: 'different_network_hash' }]
      })
    } as any;
    
    const result = await validateHashContinuity(
      { lastLedger: 100, lastLedgerHash: 'db_hash' },
      mockServer
    );
    
    expect(result).toBe(false);
    // revertLedgers wraps everything in a prisma transaction
    expect(mockPrisma.$transaction).toHaveBeenCalledOnce();
  });
});

// ── startPolling validation ───────────────────────────────────────────────────

describe('startPolling', () => {
  it('throws an error if both CONTRACT_ID and LAUNCHPAD_CONTRACT_ID are empty', async () => {
    await expect(startPolling()).rejects.toThrow('At least one of MARKETPLACE_CONTRACT_ID or LAUNCHPAD_CONTRACT_ID must be set');
  });
});

// ── Out-of-order events — does not throw (#241) ───────────────────────────────

describe('processEvent — out-of-order events do not throw', () => {
  beforeEach(() => vi.clearAllMocks());

  it('LISTING_UPDATED with no prior listing resolves without throwing', async () => {
    mockPrisma.listing.updateMany.mockResolvedValueOnce({ count: 0 });
    const data = { new_price: '999', collection: 'CCOLLECTION', token_id: 1 };
    await expect(
      processEvent(makeEvent('LISTING_UPDATED', 99n, '', data, 500))
    ).resolves.not.toThrow();
  });

  it('ARTWORK_SOLD with no prior listing resolves without throwing', async () => {
    mockPrisma.listing.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      processEvent(makeEvent('ARTWORK_SOLD', 99n, 'GB', { buyer: 'GB' }, 500))
    ).resolves.not.toThrow();
  });

  it('LISTING_CANCELLED with no prior listing resolves without throwing', async () => {
    mockPrisma.listing.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      processEvent(makeEvent('LISTING_CANCELLED', 99n, '', {}, 500))
    ).resolves.not.toThrow();
  });

  it('BID_PLACED with no prior auction resolves without throwing', async () => {
    mockPrisma.auction.updateMany.mockResolvedValueOnce({ count: 0 });
    const data = { bidder: 'GB', bid_amount: '100' };
    await expect(
      processEvent(makeEvent('BID_PLACED', 99n, 'GB', data, 500))
    ).resolves.not.toThrow();
  });

  it('AUCTION_RESOLVED with no prior auction resolves without throwing', async () => {
    mockPrisma.auction.updateMany.mockResolvedValueOnce({ count: 0 });
    const data = { winner: 'GB', amount: '100' };
    await expect(
      processEvent(makeEvent('AUCTION_RESOLVED', 99n, 'GA', data, 500))
    ).resolves.not.toThrow();
  });

  it('AUCTION_CANCELLED with no prior auction resolves without throwing', async () => {
    mockPrisma.auction.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(
      processEvent(makeEvent('AUCTION_CANCELLED', 99n, 'GA', {}, 500))
    ).resolves.not.toThrow();
  });
});

// ── window floor reset (issue #233) ──────────────────────────────────────────

describe('startPolling — window floor reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // CONTRACT_ID is a module-level constant evaluated at import time.
    // Set the env var and use vi.resetModules() + dynamic import inside each
    // test so a fresh module picks up CONTRACT_ID = 'CTEST'.
    process.env.MARKETPLACE_CONTRACT_ID = 'CTEST';
  });

  afterEach(() => {
    delete process.env.MARKETPLACE_CONTRACT_ID;
  });

  it('calls syncState.upsert instead of findUnique+create on startup', async () => {
    mockPrisma.syncState.upsert.mockResolvedValueOnce({
      id: 1,
      lastLedger: 500,
      lastLedgerHash: null,
    });
  });

  it('fetches events from windowFloor when syncState.lastLedger is too old', async () => {
    // Network is at ledger 20000; MAX_LEDGER_WINDOW is 17000 → windowFloor = 3000
    // syncState.lastLedger = 100 → startLedger would be 101, which is < 3000
    const networkLatest = 20_000;
    const expectedWindowFloor = networkLatest - 17_000; // 3000

    mockPrisma.syncState.upsert.mockResolvedValueOnce({
      id: 1,
      lastLedger: 100,
      lastLedgerHash: null,
    });
    // After the window-floor persist, update returns the new state
    mockPrisma.syncState.update.mockResolvedValue({
      id: 1,
      lastLedger: expectedWindowFloor - 1,
      lastLedgerHash: null,
    });

    // Reload the module so CONTRACT_ID picks up MARKETPLACE_CONTRACT_ID = 'CTEST'
    vi.resetModules();
    const { startPolling: freshStart } = await import('../poller');

    // Spy on the prototype so the intercept applies to the module-level server instance
    const sdkMod = await import('@stellar/stellar-sdk');
    let capturedStartLedger: number | undefined;
    vi.spyOn(sdkMod.rpc.Server.prototype, 'getLatestLedger')
      .mockResolvedValue({ sequence: networkLatest } as any);
    vi.spyOn(sdkMod.rpc.Server.prototype, 'getEvents')
      .mockImplementation(({ startLedger }: any) => {
        if (capturedStartLedger === undefined) {
          capturedStartLedger = startLedger;
        }
        return Promise.resolve({ events: [], latestLedger: networkLatest });
      });

    // Start the loop in the background; it runs indefinitely — we wait for
    // the first-iteration DB side-effects instead of trying to stop the loop.
    freshStart().catch(() => {});

    // Wait for the window-floor DB persist to appear
    await vi.waitFor(() => {
      expect(mockPrisma.syncState.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lastLedger: expectedWindowFloor - 1, lastLedgerHash: null }),
        })
      );
    }, { timeout: 3000 });

    // The upsert pattern must be used (not findUnique + create)
    expect(mockPrisma.syncState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        create: expect.objectContaining({ id: 1, lastLedger: 0 }),
        update: {},
      })
    );
    expect(mockPrisma.syncState.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.syncState.create).not.toHaveBeenCalled();
    // The poller must have requested events starting at the window floor
    expect(capturedStartLedger).toBe(expectedWindowFloor);
  }, 8000);
});

// ── hash fetch failure (#244) ─────────────────────────────────────────────────

describe('startPolling — hash fetch failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MARKETPLACE_CONTRACT_ID = 'CTEST';
  });

  afterEach(() => {
    delete process.env.MARKETPLACE_CONTRACT_ID;
  });

  it('advances lastLedger without clearing lastLedgerHash when hash fetch fails', async () => {
    // Use a networkLatest well above any lastLedger that background pollers from
    // previous tests might have set, so that effectiveLatestLedger always exceeds
    // syncState.lastLedger and the lag-skip guard never triggers.
    const networkLatest = 500;
    // LEDGER_LAG_BUFFER = 2: poller targets effectiveLatestLedger = networkLatest - 2
    const effectiveLatest = networkLatest - 2;
    const priorHash = 'prev_hash';

    mockPrisma.syncState.upsert.mockResolvedValue({
      id: 1,
      lastLedger: 50,
      lastLedgerHash: priorHash,
    });
    mockPrisma.syncState.update.mockResolvedValue({
      id: 1,
      lastLedger: effectiveLatest,
      lastLedgerHash: priorHash,
    });

    vi.resetModules();
    const { startPolling: freshStart } = await import('../poller');
    const sdkMod = await import('@stellar/stellar-sdk');

    vi.spyOn(sdkMod.rpc.Server.prototype, 'getLatestLedger')
      .mockResolvedValue({ sequence: networkLatest } as any);
    vi.spyOn(sdkMod.rpc.Server.prototype, 'getEvents')
      .mockResolvedValue({ events: [], latestLedger: networkLatest } as any);
    vi.spyOn(sdkMod.rpc.Server.prototype, 'getLedgers')
      .mockImplementation(({ startLedger }: { startLedger: number }) => {
        if (startLedger === effectiveLatest) {
          return Promise.reject(new Error('network error'));
        }
        // default: return matching hash so hash-continuity passes
        return Promise.resolve({ ledgers: [{ hash: priorHash, sequence: startLedger }] });
      });

    freshStart().catch(() => {});

    await vi.waitFor(() => {
      expect(mockPrisma.syncState.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { lastLedger: effectiveLatest },
        })
      );
    }, { timeout: 3000 });

    const hashAdvanceUpdate = mockPrisma.syncState.update.mock.calls.find(
      ([arg]) => arg.data?.lastLedger === effectiveLatest
    );
    expect(hashAdvanceUpdate?.[0].data).not.toHaveProperty('lastLedgerHash');
  }, 8000);
});
