import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// ── Mock Prisma before importing the router ───────────────────────────────────

const mockPrisma = vi.hoisted(() => ({
  listing: {
    findMany: vi.fn(),
  },
  marketplaceEvent: {
    findMany: vi.fn(),
  },
}));

vi.mock('../db', () => ({ default: mockPrisma }));

import router from '../api/routes';

// Build a minimal Express app with the router mounted at root
const app = express();
app.use(express.json());
app.use(router);

// ── Sample fixtures ───────────────────────────────────────────────────────────

const sampleListing = {
  listingId: BigInt(1),
  artist: 'GABC123',
  owner: null,
  price: '10000000.0000000',
  currency: 'XLM',
  metadataCid: 'QmTest',
  token: 'CTOKEN',
  status: 'Active',
  royaltyBps: 500,
  createdAtLedger: 100,
  updatedAtLedger: 100,
};

const sampleEvent = {
  id: 1,
  listingId: BigInt(1),
  eventType: 'LISTING_CREATED',
  actor: 'GABC123',
  data: { price: '10000000' },
  ledgerSequence: 100,
  ledgerTimestamp: new Date('2024-01-01T00:00:00Z'),
};

// ── GET /listings ─────────────────────────────────────────────────────────────

describe('GET /listings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns all listings as JSON', async () => {
    mockPrisma.listing.findMany.mockResolvedValue([sampleListing]);

    const res = await request(app).get('/listings');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    // BigInt was serialised to string
    expect(res.body[0].listingId).toBe('1');
    expect(res.body[0].artist).toBe('GABC123');
    expect(res.body[0].status).toBe('Active');
  });

  it('filters by artist query param', async () => {
    mockPrisma.listing.findMany.mockResolvedValue([sampleListing]);

    await request(app).get('/listings?artist=GABC123');

    expect(mockPrisma.listing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { artist: 'GABC123' } })
    );
  });

  it('filters by owner query param', async () => {
    mockPrisma.listing.findMany.mockResolvedValue([]);

    await request(app).get('/listings?owner=GBOWNER');

    expect(mockPrisma.listing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { owner: 'GBOWNER' } })
    );
  });

  it('applies both artist and owner filters when both are provided', async () => {
    mockPrisma.listing.findMany.mockResolvedValue([]);

    await request(app).get('/listings?artist=GABC&owner=GBOWN');

    expect(mockPrisma.listing.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { artist: 'GABC', owner: 'GBOWN' } })
    );
  });

  it('returns empty array when no listings match', async () => {
    mockPrisma.listing.findMany.mockResolvedValue([]);

    const res = await request(app).get('/listings');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns 500 when Prisma throws', async () => {
    mockPrisma.listing.findMany.mockRejectedValue(new Error('DB down'));

    const res = await request(app).get('/listings');
    expect(res.status).toBe(500);
    expect(res.body.error).toBeDefined();
  });
});

// ── GET /listings/:id/history ─────────────────────────────────────────────────

describe('GET /listings/:id/history', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the event history for a listing', async () => {
    mockPrisma.marketplaceEvent.findMany.mockResolvedValue([sampleEvent]);

    const res = await request(app).get('/listings/1/history');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].eventType).toBe('LISTING_CREATED');
    // listingId BigInt serialised to string
    expect(res.body[0].listingId).toBe('1');
  });

  it('queries by the correct BigInt listingId', async () => {
    mockPrisma.marketplaceEvent.findMany.mockResolvedValue([]);

    await request(app).get('/listings/42/history');

    expect(mockPrisma.marketplaceEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { listingId: BigInt('42') } })
    );
  });

  it('returns empty array when no events exist for the listing', async () => {
    mockPrisma.marketplaceEvent.findMany.mockResolvedValue([]);

    const res = await request(app).get('/listings/99/history');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns 500 when Prisma throws', async () => {
    mockPrisma.marketplaceEvent.findMany.mockRejectedValue(new Error('DB down'));

    const res = await request(app).get('/listings/1/history');
    expect(res.status).toBe(500);
  });
});

// ── GET /activity/recent ──────────────────────────────────────────────────────

describe('GET /activity/recent', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns recent events', async () => {
    const events = Array.from({ length: 5 }, (_, i) => ({
      ...sampleEvent,
      id: i + 1,
      ledgerSequence: 100 + i,
    }));
    mockPrisma.marketplaceEvent.findMany.mockResolvedValue(events);

    const res = await request(app).get('/activity/recent');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(5);
  });

  it('requests at most 20 records ordered by ledger descending', async () => {
    mockPrisma.marketplaceEvent.findMany.mockResolvedValue([]);

    await request(app).get('/activity/recent');

    expect(mockPrisma.marketplaceEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 20,
        orderBy: { ledgerSequence: 'desc' },
      })
    );
  });

  it('returns 500 when Prisma throws', async () => {
    mockPrisma.marketplaceEvent.findMany.mockRejectedValue(new Error('DB error'));

    const res = await request(app).get('/activity/recent');
    expect(res.status).toBe(500);
  });
});
