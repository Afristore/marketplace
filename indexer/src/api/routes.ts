import { Router, Request, Response } from 'express';
import prisma from '../db.js';
import { cacheMiddleware } from './cache-middleware.js';
import { strictRateLimiter } from './rate-limit-middleware.js';
import axios from 'axios';

const router = Router();

// Helper to serialize BigInts to strings for JSON
const serialize = (obj: any) => 
    JSON.parse(JSON.stringify(obj, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
    ));

// GET /listings?artist=&status=&minPrice=&maxPrice=&search=&limit=&offset=
router.get('/listings', async (req: Request, res: Response) => {
    const { artist, owner, status, limit, offset, minPrice, maxPrice, search } = req.query;
    try {
        const where: any = {};
        if (artist) where.artist = artist as string;
        if (owner) where.owner = owner as string;
        if (status) where.status = status as string;

        if (minPrice || maxPrice) {
            where.price = {};
            if (minPrice) where.price.gte = minPrice as string;
            if (maxPrice) where.price.lte = maxPrice as string;
        }

        // Search against artist address or metadataCid
        if (search) {
            const q = search as string;
            where.OR = [
                { artist: { contains: q, mode: 'insensitive' } },
                { metadataCid: { contains: q, mode: 'insensitive' } },
            ];
        }

        const take = Math.max(0, Math.min(Number(limit || 0), 1000)) || undefined;
        const skip = Number(offset || 0) || undefined;

        const results = await prisma.listing.findMany({
            where,
            orderBy: { updatedAtLedger: 'desc' },
            take,
            skip,
        });

        // If pagination requested, also return total count
        if (take !== undefined || skip !== undefined) {
            const total = await prisma.listing.count({ where });
            return res.json({ listings: serialize(results), total });
        }

        res.json(serialize(results));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch listings' });
    }
});

// GET /listings/:id — single listing with metadata (if available)
router.get('/listings/:id', async (req: Request, res: Response) => {
    const { id } = req.params;
    try {
        const listing = await prisma.listing.findUnique({
            where: { listingId: BigInt(id as string) },
        });
        if (!listing) return res.status(404).json({ error: 'Listing not found' });

        const out: any = serialize(listing);
        // Try to fetch metadata from IPFS gateway if available
        const gateway = process.env.IPFS_GATEWAY || 'https://ipfs.io/ipfs/';
        try {
            const cid = listing.metadataCid || listing.metadata_cid || null;
            if (cid) {
                const url = cid.startsWith('ipfs://') ? `${gateway}${cid.replace(/^ipfs:\/\//, '')}` : `${gateway}${cid}`;
                const r = await axios.get(url, { timeout: 5000 });
                out.metadata = r.data;
            } else {
                out.metadata = null;
            }
        } catch (e) {
            out.metadata = null;
        }

        res.json(out);
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch listing' });
    }
});

// GET /listings/:id/history — full event timeline for a single listing
router.get('/listings/:id/history', async (req: Request, res: Response) => {
    const id = req.params.id as string;
    if (!/^\d+$/.test(id)) {
        return res.status(400).json({ error: 'Invalid ID format' });
    }
    try {
        const results = await prisma.marketplaceEvent.findMany({
            where: { listingId: BigInt(id) },
            orderBy: { ledgerSequence: 'asc' },
        });
        res.json(serialize(results));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch listing history' });
    }
});

// GET /auctions — all active or finished auctions
router.get('/auctions', async (req: Request, res: Response) => {
    const { creator, status } = req.query;
    try {
        const where: any = {};
        if (creator) where.creator = creator as string;
        if (status) where.status = status as string;

        const results = await prisma.auction.findMany({
            where,
            orderBy: { updatedAtLedger: 'desc' },
        });
        res.json(serialize(results));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch auctions' });
    }
});

// GET /auctions/:id — a single auction by ID
router.get('/auctions/:id', async (req: Request, res: Response) => {
    const id = req.params.id as string;
    if (!/^\d+$/.test(id)) {
        return res.status(400).json({ error: 'Invalid ID format' });
    }
    try {
        const result = await prisma.auction.findUnique({
            where: { auctionId: BigInt(id) },
        });
        if (!result) {
            return res.status(404).json({ error: 'Auction not found' });
        }
        res.json(serialize(result));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch auction' });
    }
});

// GET /offers — all offers for a listing
router.get('/offers', async (req: Request, res: Response) => {
    const { listing_id } = req.query;
    try {
        const where: any = {};
        if (listing_id) {
            if (!/^\d+$/.test(listing_id as string)) {
                return res.status(400).json({ error: 'Invalid listing_id format' });
            }
            where.listingId = BigInt(listing_id as string);
        }

        const results = await prisma.offer.findMany({
            where,
            orderBy: { updatedAtLedger: 'desc' },
        });
        res.json(serialize(results));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch offers' });
    }
});

// GET /activity/recent — latest sales and listings across the marketplace
// Cache for 30 seconds to handle traffic spikes
router.get('/activity/recent', cacheMiddleware(30), async (req: Request, res: Response) => {
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


// GET /collections — all deployed collections
// Cache for 60 seconds to handle traffic spikes
router.get('/collections', cacheMiddleware(60), async (req: Request, res: Response) => {
    const { kind, creator } = req.query;
    try {
        const where: any = {};
        if (kind)    where.kind    = kind as string;
        if (creator) where.creator = creator as string;
        const results = await prisma.collection.findMany({
            where,
            orderBy: { deployedAtLedger: 'desc' },
        });
        res.json(serialize(results));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch collections' });
    }
});

// GET /creators/:address/collections — collections deployed by a creator
router.get('/creators/:address/collections', async (req: Request, res: Response) => {
    const { address } = req.params;
    try {
        const results = await prisma.collection.findMany({
            where: { creator: address as string },
            orderBy: { deployedAtLedger: 'desc' },
        });
        res.json(serialize(results));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch creator collections' });
    }
});

// GET /wallets/:address/activity — events relevant to a Stellar account
router.get('/wallets/:address/activity', strictRateLimiter, async (req: Request, res: Response) => {
    const address = req.params.address as string;
    const take = Math.min(parseInt(String(req.query.limit || '50'), 10) || 50, 200);
    try {
        const jsonKeys = ['buyer', 'artist', 'offerer', 'bidder', 'winner', 'creator'];
        const fromJson = jsonKeys.map((path) => ({
            data: { path: [path], equals: address },
        }));

        const events = await prisma.marketplaceEvent.findMany({
            where: {
                OR: [{ actor: address }, ...fromJson],
            },
            orderBy: { ledgerSequence: 'desc' },
            take,
        });

        res.json(serialize(events));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch wallet activity' });
    }
});

// GET /wallets/:address/royalty-stats — aggregates royalty-bearing sales for an artist
router.get('/wallets/:address/royalty-stats', strictRateLimiter, async (req: Request, res: Response) => {
    const { address } = req.params;
    try {
        const sold = await prisma.listing.findMany({
            where: { artist: address as string, status: 'Sold' },
            select: {
                listingId: true,
                price: true,
                royaltyBps: true,
            },
        });

        let totalEarned = 0;
        for (const row of sold) {
            const p = Number(row.price);
            totalEarned += (p * row.royaltyBps) / 10000;
        }

        const lastEvent = await prisma.marketplaceEvent.findFirst({
            where: { eventType: 'ARTWORK_SOLD', actor: address as string },
            orderBy: { ledgerSequence: 'desc' },
        });

        res.json({
            totalEarned: totalEarned.toFixed(7),
            payoutCount: sold.length,
            lastPayout: lastEvent?.ledgerTimestamp
                ? new Date(lastEvent.ledgerTimestamp).getTime()
                : 0,
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch royalty stats' });
    }
});

export default router;

