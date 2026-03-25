import { Router, Request, Response } from 'express';
import prisma from '../db';

const router = Router();

// Helper to serialize BigInts to strings for JSON
const serialize = (obj: any) => 
    JSON.parse(JSON.stringify(obj, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
    ));

// GET /listings?artist= — all listings created by an artist
router.get('/listings', async (req: Request, res: Response) => {
    const { artist, owner } = req.query;
    try {
        const where: any = {};
        if (artist) where.artist = artist as string;
        if (owner) where.owner = owner as string;

        const results = await prisma.listing.findMany({
            where,
            orderBy: { updatedAtLedger: 'desc' },
        });
        res.json(serialize(results));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch listings' });
    }
});

// GET /listings/:id/history — full event timeline for a single listing
router.get('/listings/:id/history', async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const results = await prisma.marketplaceEvent.findMany({
            where: { listingId: BigInt(id as string) },
            orderBy: { ledgerSequence: 'asc' },
        });
        res.json(serialize(results));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch listing history' });
    }
});

// GET /activity/recent — latest sales and listings across the marketplace
router.get('/activity/recent', async (req: Request, res: Response) => {
    try {
        const results = await prisma.marketplaceEvent.findMany({
            take: 20,
            orderBy: { ledgerSequence: 'desc' },
        });
        res.json(serialize(results));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch recent activity' });
    }
});

export default router;
