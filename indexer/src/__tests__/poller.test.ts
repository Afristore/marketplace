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
}));

vi.mock('../db', () => ({ default: mockPrisma }));

// Stellar SDK is not needed by processEvent, but poller.ts imports rpc from it.
// Provide a minimal stub so the module resolves without a real network connection.
vi.mock('@stellar/stellar-sdk', () => ({
  rpc: {
    Server: class {
      getEvents() { return Promise.resolve({ events: [] }); }
    },
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

  it('sets listing status to Auction', async () => {
    await processEvent(makeEvent('AUCTION_CREATED', 11n, 'GA_CREATOR', {}, 600));

    expect(mockPrisma.listing.update).toHaveBeenCalledWith({
      where: { listingId: 11n },
      data: expect.objectContaining({ status: 'Auction' }),
    });
  });
});

// ── Events with no listingId ──────────────────────────────────────────────────

describe('processEvent — null listingId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('logs the event but skips listing mutations when listingId is null', async () => {
    await processEvent(makeEvent('OFFER_MADE', null, 'GA_OFFERER', {}));

    expect(mockPrisma.marketplaceEvent.create).toHaveBeenCalledOnce();
    expect(mockPrisma.listing.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.listing.update).not.toHaveBeenCalled();
  });
});

// ── Unhandled eventTypes ──────────────────────────────────────────────────────

describe('processEvent — unhandled event types', () => {
  beforeEach(() => vi.clearAllMocks());

  const offerEventTypes = ['OFFER_MADE', 'OFFER_ACCEPTED', 'OFFER_REJECTED', 'OFFER_WITHDRAWN', 'BID_PLACED', 'AUCTION_RESOLVED'];

  for (const type of offerEventTypes) {
    it(`logs ${type} without touching the listing table`, async () => {
      await processEvent(makeEvent(type, 1n, 'GA', {}));

      expect(mockPrisma.marketplaceEvent.create).toHaveBeenCalledOnce();
      expect(mockPrisma.listing.upsert).not.toHaveBeenCalled();
      expect(mockPrisma.listing.update).not.toHaveBeenCalled();
    });
  }
});
