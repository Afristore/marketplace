import { Router, Request, Response } from 'express';
import prisma from '../db.js';

const router = Router();

// Helper to serialize BigInts and Decimals
const serialize = (obj: any) =>
    JSON.parse(JSON.stringify(obj, (_k, v) => typeof v === 'bigint' ? v.toString() : v));

// GET /listings?collection=&currency=&limit=&offset=
router.get('/listings', async (req: Request, res: Response) => {
    const { collection, currency, limit, offset } = req.query;
    try {
        const where: any = { status: 'Open' };
        if (collection) where.collection = String(collection);
        if (currency) where.currency = String(currency);

        const take = Number(limit) > 0 ? Math.min(Number(limit), 1000) : 50;
        const rawOffset = Number(offset || 0);
        const skip = Number.isFinite(rawOffset) && rawOffset > 0
            ? Math.min(rawOffset, 10_000)
            : undefined;

        // Use dynamic access to avoid compile-time Prisma model typing assumptions
        const listingModel = (prisma as any).lendingListing ?? (prisma as any).LendingListing;

        if (!listingModel) {
            return res.status(500).json({ error: 'LendingListing model not available in Prisma client' });
        }

        const results = await listingModel.findMany({ where, take, skip, orderBy: { createdAtLedger: 'desc' } });
        const total = await listingModel.count({ where });
        res.json({ listings: serialize(results), total });
    } catch (err) {
        console.error('Error fetching lending listings:', err);
        res.status(500).json({ error: 'Failed to fetch lending listings' });
    }
});

// GET /positions/:borrower?status=
router.get('/positions/:borrower', async (req: Request, res: Response) => {
    const { borrower } = req.params;
    const { status } = req.query;
    try {
        const posModel = (prisma as any).lendingPosition ?? (prisma as any).LendingPosition;
        const listModel = (prisma as any).lendingListing ?? (prisma as any).LendingListing;
        if (!posModel) return res.status(500).json({ error: 'LendingPosition model not available' });

        const where: any = { borrower };
        if (status) where.status = String(status);

        const positions = await posModel.findMany({ where, orderBy: { updatedAtLedger: 'desc' } });

        // Join with listing details where possible
        const merged = await Promise.all(positions.map(async (p: any) => {
            let listing = null;
            try {
                if (listModel && p.listingId !== undefined && p.listingId !== null) {
                    listing = await listModel.findUnique({ where: { listingId: p.listingId } });
                }
            } catch {
                listing = null;
            }
            return { position: p, listing };
        }));

        res.json(serialize(merged));
    } catch (err) {
        console.error('Error fetching lending positions:', err);
        res.status(500).json({ error: 'Failed to fetch lending positions' });
    }
});

// GET /loans/:lender?limit=&offset=
router.get('/loans/:lender', async (req: Request, res: Response) => {
    const { lender } = req.params;
    const { limit, offset } = req.query;
    try {
        const listingModel = (prisma as any).lendingListing ?? (prisma as any).LendingListing;
        const posModel = (prisma as any).lendingPosition ?? (prisma as any).LendingPosition;

        const take = Number(limit) > 0 ? Math.min(Number(limit), 1000) : 50;
        const rawOffset = Number(offset || 0);
        const skip = Number.isFinite(rawOffset) && rawOffset > 0
            ? Math.min(rawOffset, 10_000)
            : undefined;

        const listings = listingModel ? await listingModel.findMany({ where: { lender }, take, skip, orderBy: { updatedAtLedger: 'desc' } }) : [];
        const positions = posModel ? await posModel.findMany({ where: { lender }, take, skip, orderBy: { updatedAtLedger: 'desc' } }) : [];

        res.json(serialize({ listings, positions }));
    } catch (err) {
        console.error('Error fetching loans by lender:', err);
        res.status(500).json({ error: 'Failed to fetch loans' });
    }
});

// GET /stats — TVL, activeLoans, totalVolume
router.get('/stats', async (_req: Request, res: Response) => {
    try {
        const posModel = (prisma as any).lendingPosition ?? (prisma as any).LendingPosition;
        if (!posModel) return res.status(500).json({ error: 'LendingPosition model not available' });

        const tvlAgg = await posModel.aggregate({ _sum: { principal: true }, where: { status: 'Active' } });
        const tvl = tvlAgg._sum?.principal?.toString?.() ?? '0';

        const activeLoans = await posModel.count({ where: { status: 'Active' } });

        const volumeAgg = await posModel.aggregate({ _sum: { principal: true }, where: {} });
        const totalVolume = volumeAgg._sum?.principal?.toString?.() ?? '0';

        res.json({ tvl, activeLoans, totalVolume });
    } catch (err) {
        console.error('Error fetching lending stats:', err);
        res.status(500).json({ error: 'Failed to fetch lending stats' });
    }
});

export default router;
