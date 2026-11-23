import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Mock Prisma and Redis before importing the router
const mockPrisma = vi.hoisted(() => ({
  lendingPosition: {
    aggregate: vi.fn(),
    count: vi.fn(),
    findMany: vi.fn(),
  },
  lendingListing: {
    findMany: vi.fn(),
    count: vi.fn(),
    findUnique: vi.fn(),
  },
  lendingConfig: {
    findUnique: vi.fn(),
  },
  // Array form: Promise.all(ops). Interactive form: callback(prisma).
  $transaction: vi.fn(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: typeof mockPrisma) => Promise<unknown>)(mockPrisma);
    }
    if (Array.isArray(arg)) {
      return Promise.all(arg);
    }
    return arg;
  }),
}));

const mockRedis = vi.hoisted(() => ({
  isOpen: false,
  isReady: false,
  get: vi.fn(),
  set: vi.fn().mockResolvedValue(undefined),
  setEx: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  connect: vi.fn().mockRejectedValue(new Error('No Redis')),
}));

vi.mock('../db.js', () => ({ default: mockPrisma }));
vi.mock('../redis.js', () => ({ default: mockRedis }));

import lendingRouter from '../api/lending.js';

describe('Lending Stats API (/api/lending/stats)', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis.isReady = false;
    app = express();
    app.use(express.json());
    // Mount router at /api/lending matching production index.ts and routes.ts
    app.use('/api/lending', lendingRouter);
  });

  it('calculates TVL sum, active loans count, and total volume correctly', async () => {
    mockPrisma.lendingPosition.aggregate
      .mockResolvedValueOnce({
        _sum: { collateralAmount: 50000000000n },
      })
      .mockResolvedValueOnce({
        _sum: { collateralAmount: 125000000000n },
      });
    mockPrisma.lendingPosition.count.mockResolvedValueOnce(7);

    const res = await request(app)
      .get('/api/lending/stats')
      .expect(200);

    expect(res.body).toEqual({
      tvl: '50000000000',
      activeLoans: 7,
      totalVolume: '125000000000',
    });

    // Verify aggregate queries
    expect(mockPrisma.lendingPosition.aggregate).toHaveBeenNthCalledWith(1, {
      _sum: { collateralAmount: true },
      where: { status: 'Active' },
    });
    expect(mockPrisma.lendingPosition.count).toHaveBeenCalledWith({
      where: { status: 'Active' },
    });
    expect(mockPrisma.lendingPosition.aggregate).toHaveBeenNthCalledWith(2, {
      _sum: { collateralAmount: true },
      where: {},
    });
  });

  it('handles null / zero sums gracefully with default string "0"', async () => {
    mockPrisma.lendingPosition.aggregate
      .mockResolvedValueOnce({
        _sum: { collateralAmount: null },
      })
      .mockResolvedValueOnce({
        _sum: { collateralAmount: null },
      });
    mockPrisma.lendingPosition.count.mockResolvedValueOnce(0);

    const res = await request(app)
      .get('/api/lending/stats')
      .expect(200);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      tvl: '0',
      activeLoans: 0,
      totalVolume: '0',
    });
  });

  it('properly serializes BigInt values into JSON string format', async () => {
    const hugeCollateralTvl = 900719925474099300000n;
    const hugeCollateralVolume = 1800719925474099300000n;

    mockPrisma.lendingPosition.aggregate
      .mockResolvedValueOnce({
        _sum: { collateralAmount: hugeCollateralTvl },
      })
      .mockResolvedValueOnce({
        _sum: { collateralAmount: hugeCollateralVolume },
      });
    mockPrisma.lendingPosition.count.mockResolvedValueOnce(42);

    const res = await request(app)
      .get('/api/lending/stats')
      .expect(200);

    expect(typeof res.body.tvl).toBe('string');
    expect(res.body.tvl).toBe(hugeCollateralTvl.toString());
    expect(res.body.totalVolume).toBe(hugeCollateralVolume.toString());
    expect(res.body.activeLoans).toBe(42);
  });

  it('returns cached stats from Redis when available without querying Prisma', async () => {
    mockRedis.isReady = true;
    const cachedData = {
      tvl: '999000000',
      activeLoans: 12,
      totalVolume: '3330000000',
    };
    mockRedis.get.mockResolvedValueOnce(JSON.stringify(cachedData));

    const res = await request(app)
      .get('/api/lending/stats')
      .expect(200);

    expect(res.body).toEqual(cachedData);
    expect(mockRedis.get).toHaveBeenCalledWith('lending:stats');
    expect(mockPrisma.lendingPosition.aggregate).not.toHaveBeenCalled();
    expect(mockPrisma.lendingPosition.count).not.toHaveBeenCalled();
  });

  it('stores calculated stats in Redis cache when Redis is ready', async () => {
    mockRedis.isReady = true;
    mockRedis.get.mockResolvedValueOnce(null);

    mockPrisma.lendingPosition.aggregate
      .mockResolvedValueOnce({
        _sum: { collateralAmount: 1000n },
      })
      .mockResolvedValueOnce({
        _sum: { collateralAmount: 5000n },
      });
    mockPrisma.lendingPosition.count.mockResolvedValueOnce(2);

    const res = await request(app)
      .get('/api/lending/stats')
      .expect(200);

    expect(res.status).toBe(200);
    expect(mockRedis.setEx).toHaveBeenCalledWith(
      'lending:stats',
      300,
      JSON.stringify({ tvl: '1000', activeLoans: 2, totalVolume: '5000' })
    );
  });

  it('returns 500 error when Prisma database throws an exception', async () => {
    mockPrisma.lendingPosition.aggregate.mockRejectedValueOnce(new Error('Prisma database connection error'));

    const res = await request(app)
      .get('/api/lending/stats')
      .expect(500);

    expect(res.body).toEqual({
      error: 'Failed to fetch lending stats',
    });
  });
});
