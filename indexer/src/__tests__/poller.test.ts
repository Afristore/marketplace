import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock Prisma ───────────────────────────────────────────────────────────────

const mockPrisma = vi.hoisted(() => ({
  marketplaceEvent: {
    create: vi.fn().mockResolvedValue({}),
  },
  listing: {
    upsert: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
  },
  syncState: {
    findUnique: vi.fn(),
    create: vi.fn().mockResolvedValue({ id: 1, lastLedger: 0 }),
    update: vi.fn().mockResolvedValue({}),
  },
  collection: {
    upsert: vi.fn().mockResolvedValue({}),
  },
  auction: {
    upsert: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
  },
  offer: {
    upsert: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock('../db', () => ({ default: mockPrisma }));

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

import { processEvent } from '../poller';

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
    const data = { price: '1000000', currency: 'XLM' };
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
      metadata_cid: 'QmTest123',
      token: 'CTOKEN',
      royalty_bps: '500',
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

  it('does not call listing.update for LISTING_CREATED', async () => {
    await processEvent(makeEvent('LISTING_CREATED', 1n, 'GA', { artist: 'GA' }, 1));
    expect(mockPrisma.listing.update).not.toHaveBeenCalled();
  });
});

// ── Listing update on LISTING_UPDATED ────────────────────────────────────────

describe('processEvent — LISTING_UPDATED', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates price and metadataCid', async () => {
    const data = { new_price: '20000000', metadata_cid: 'QmNewCid' };
    await processEvent(makeEvent('LISTING_UPDATED', 5n, '', data, 300));

    expect(mockPrisma.listing.update).toHaveBeenCalledOnce();
    expect(mockPrisma.listing.update).toHaveBeenCalledWith({
      where: { listingId: 5n },
      data: expect.objectContaining({
        price: '20000000',
        metadataCid: 'QmNewCid',
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

    expect(mockPrisma.listing.update).toHaveBeenCalledWith({
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

    expect(mockPrisma.listing.update).toHaveBeenCalledWith({
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

    expect(mockPrisma.auction.update).toHaveBeenCalledOnce();
    expect(mockPrisma.auction.update).toHaveBeenCalledWith({
      where: { auctionId: 11n },
      data: expect.objectContaining({
        highestBid: '55000000',
        highestBidder: 'GB_BIDDER',
        updatedAtLedger: 610,
      }),
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

    expect(mockPrisma.auction.update).toHaveBeenCalledOnce();
    expect(mockPrisma.auction.update).toHaveBeenCalledWith({
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

    expect(mockPrisma.listing.update).toHaveBeenCalledOnce();
    expect(mockPrisma.listing.update).toHaveBeenCalledWith({
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
