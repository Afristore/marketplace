import { Router, Request, Response } from 'express';
import prisma from '../db.js';
import redis from '../redis.js';

const LENDING_CACHE_TTL = 300; // 5 minutes

const router = Router();

// Helper to serialize BigInts and Decimals
const serialize = (obj: any) =>
  JSON.parse(JSON.stringify(obj, (_k, v) => typeof v === 'bigint' ? v.toString() : v));

async function getCachedStats(cacheKey: string): Promise<any | null> {
  if (!redis || !redis.isReady) return null;
  try {
    const cached = await redis.get(cacheKey);
    return cached ? JSON.parse(cached) : null;
  } catch (err) {
    console.error('[Lending API] Cache read error:', err);
    return null;
  }
}

async function setCachedStats(cacheKey: string, data: any, ttl: number = LENDING_CACHE_TTL): Promise<void> {
  if (!redis || !redis.isReady) return;
  try {
    await redis.setEx(cacheKey, ttl, JSON.stringify(data));
  } catch (err) {
    console.error('[Lending API] Cache write error:', err);
  }
}

// GET /listings?collection=&currency=&limit=&offset=
router.get('/listings', async (req: Request, res: Response) => {
  const { collection, currency, limit, offset } = req.query;
  const cacheKey = `lending:listings:${collection}:${currency}:${limit}:${offset}`;

  const cached = await getCachedStats(cacheKey);
  if (cached) {
    return res.json(cached);
  }

  try {
    const where: any = { status: 'Open' };
    if (collection) where.nftContract = String(collection);
    if (currency) where.currency = String(currency);

    const take = Number(limit) > 0 ? Math.min(Number(limit), 1000) : 50;
    const rawOffset = Number(offset || 0);
    const skip = Number.isFinite(rawOffset) && rawOffset > 0
      ? Math.min(rawOffset, 10_000)
      : undefined;

    const results = await prisma.lendingListing.findMany({
      where,
      take,
      skip,
      orderBy: { createdAtLedger: 'desc' }
    });
    const total = await prisma.lendingListing.count({ where });

    const response = { listings: serialize(results), total };
    await setCachedStats(cacheKey, response);
    res.json(response);
  } catch (err) {
    console.error('Error fetching lending listings:', err);
    res.status(500).json({ error: 'Failed to fetch lending listings' });
  }
});

// GET /positions/:borrower?status=
router.get('/positions/:borrower', async (req: Request, res: Response) => {
  const borrower = req.params.borrower as string;
  const { status } = req.query;
  const cacheKey = `lending:positions:${borrower}:${status || 'all'}`;

  const cached = await getCachedStats(cacheKey);
  if (cached) {
    return res.json(cached);
  }

  try {
    const where: any = { borrower };
    if (status) where.status = String(status);

    const positions = await prisma.lendingPosition.findMany({
      where,
      orderBy: { updatedAtLedger: 'desc' }
    });

    // Join with listing details where possible
    const merged = await Promise.all(positions.map(async (p: any) => {
      let listing = null;
      try {
        if (p.listingId !== undefined && p.listingId !== null) {
          listing = await prisma.lendingListing.findUnique({
            where: { listingId: p.listingId }
          });
        }
      } catch {
        listing = null;
      }
      return { position: p, listing };
    }));

    const response = serialize(merged);
    await setCachedStats(cacheKey, response);
    res.json(response);
  } catch (err) {
    console.error('Error fetching lending positions:', err);
    res.status(500).json({ error: 'Failed to fetch lending positions' });
  }
});

// GET /loans/:lender?limit=&offset=
router.get('/loans/:lender', async (req: Request, res: Response) => {
  const lender = req.params.lender as string;
  const { limit, offset } = req.query;
  const cacheKey = `lending:loans:${lender}:${limit}:${offset}`;

  const cached = await getCachedStats(cacheKey);
  if (cached) {
    return res.json(cached);
  }

  try {
    const take = Number(limit) > 0 ? Math.min(Number(limit), 1000) : 50;
    const rawOffset = Number(offset || 0);
    const skip = Number.isFinite(rawOffset) && rawOffset > 0
      ? Math.min(rawOffset, 10_000)
      : undefined;

    const listings = await prisma.lendingListing.findMany({
      where: { lender },
      take,
      skip,
      orderBy: { updatedAtLedger: 'desc' }
    });
    const positions = await prisma.lendingPosition.findMany({
      where: { lender },
      take,
      skip,
      orderBy: { updatedAtLedger: 'desc' }
    });

    const response = serialize({ listings, positions });
    await setCachedStats(cacheKey, response);
    res.json(response);
  } catch (err) {
    console.error('Error fetching loans by lender:', err);
    res.status(500).json({ error: 'Failed to fetch loans' });
  }
});

// GET /stats — TVL, activeLoans, totalVolume
router.get('/stats', async (_req: Request, res: Response) => {
  const cacheKey = 'lending:stats';

  const cached = await getCachedStats(cacheKey);
  if (cached) {
    return res.json(cached);
  }

  try {
    const tvlAgg = await prisma.lendingPosition.aggregate({
      _sum: { collateralAmount: true },
      where: { status: 'Active' }
    });
    const tvl = tvlAgg._sum?.collateralAmount?.toString?.() ?? '0';

    const activeLoans = await prisma.lendingPosition.count({ where: { status: 'Active' } });

    const volumeAgg = await prisma.lendingPosition.aggregate({
      _sum: { collateralAmount: true },
      where: {}
    });
    const totalVolume = volumeAgg._sum?.collateralAmount?.toString?.() ?? '0';

    const response = { tvl, activeLoans, totalVolume };
    await setCachedStats(cacheKey, response);
    res.json(response);
  } catch (err) {
    console.error('Error fetching lending stats:', err);
    res.status(500).json({ error: 'Failed to fetch lending stats' });
  }
});

// GET /config — LendingConfig
router.get('/config', async (_req: Request, res: Response) => {
  const cacheKey = 'lending:config';

  const cached = await getCachedStats(cacheKey);
  if (cached) {
    return res.json(cached);
  }

  try {
    const config = await prisma.lendingConfig.findUnique({
      where: { id: 1 }
    });

    if (!config) {
      return res.status(404).json({ error: 'Lending config not found' });
    }

    const response = serialize(config);
    await setCachedStats(cacheKey, response);
    res.json(response);
  } catch (err) {
    console.error('Error fetching lending config:', err);
    res.status(500).json({ error: 'Failed to fetch lending config' });
  }
});

export default router;
