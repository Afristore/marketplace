import { Router, Request, Response } from 'express';
import axios from 'axios';
import prisma from '../db.js';
import redis from '../redis.js';
import { cacheMiddleware } from './cache-middleware.js';
import { strictRateLimiter } from './rate-limit-middleware.js';

// SSE clients registry
const sseClients: Response[] = [];
export function emitSSEEvent(event: any) {
    const data = `data: ${JSON.stringify(event, (_k, v) => typeof v === 'bigint' ? v.toString() : v)}\n\n`;
    for (const client of sseClients) {
        try { client.write(data); } catch { /* ignore closed connections */ }
    }
}

const router = Router();

const CACHE_TTL_SECONDS = parseInt(process.env.REDIS_CACHE_TTL_SECONDS || '30');

async function getCached<T>(key: string, ttl: number, fetcher: () => Promise<T>): Promise<T> {
    try {
        const cached = await redis.get(key);
        if (cached) return JSON.parse(cached) as T;
    } catch {
        // Redis unavailable — fall through to DB
    }
    const result = await fetcher();
    try {
        await redis.set(key, JSON.stringify(result), { EX: ttl });
    } catch {
        // ignore cache write failures
    }
    return result;
}

// Helper to serialize BigInts to strings for JSON
const serialize = (obj: any) =>
    JSON.parse(JSON.stringify(obj, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
    ));

const mapListing = (l: any) => {
    if (!l) return l;
    return {
        ...l,
        listing_id: l.listingId,
        metadata_cid: l.metadataCid,
        token_id: l.nftTokenId,
        created_at: l.createdAtLedger,
    };
};

const mapAuction = (a: any) => {
    if (!a) return a;
    return {
        ...a,
        auction_id: a.auctionId,
        metadata_cid: a.metadataCid,
        token_id: a.nftTokenId,
        created_at: a.createdAtLedger,
        reserve_price: a.reservePrice,
        highest_bid: a.highestBid,
        highest_bidder: a.highestBidder,
        end_time: a.endTime,
    };
};

// Normalise IPFS gateway — always ensure it ends with /
function normaliseGateway(gateway: string): string {
    return gateway.endsWith('/') ? gateway : `${gateway}/`;
}

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

        // Search against artist address or collection
        if (search) {
            const q = search as string;
            where.OR = [
                { artist: { contains: q, mode: 'insensitive' } },
                { collection: { contains: q, mode: 'insensitive' } },
            ];
        }

        const take = Number(limit) > 0 ? Math.min(Number(limit), 1000) : 50;
        const rawOffset = Number(offset || 0);
        const skip = Number.isFinite(rawOffset) && rawOffset > 0
            ? Math.min(rawOffset, 10_000)
            : undefined;

        const results = await prisma.listing.findMany({
            where,
            orderBy: { updatedAtLedger: 'desc' },
            take,
            skip,
        });

        const total = await prisma.listing.count({ where });
        return res.json({ listings: serialize(results.map(mapListing)), total });
    } catch (err) {
        console.error('Error details:', err);
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

        const out: any = serialize(mapListing(listing));
        return res.json(out);
    } catch (err) {
        console.error('Error details:', err);
        res.status(500).json({ error: 'Failed to fetch listing details' });
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
        console.error('Error details:', err);
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
        console.error('Error details:', err);
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
        console.error('Error details:', err);
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
        console.error('Error details:', err);
        res.status(500).json({ error: 'Failed to fetch offers' });
    }
});

// GET /activity/recent — latest sales and listings across the marketplace
// Cache for 30 seconds to handle traffic spikes
router.get('/activity/recent', cacheMiddleware(30), async (req: Request, res: Response) => {
    try {
        const results = await getCached('activity:recent', CACHE_TTL_SECONDS, () =>
            prisma.marketplaceEvent.findMany({
                take: 20,
                orderBy: { ledgerSequence: 'desc' },
            })
        );
        res.json(serialize(results));
    } catch (err) {
        console.error('Error details:', err);
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
        const cacheKey = `collections:${kind ?? ''}:${creator ?? ''}`;
        const results = await getCached(cacheKey, CACHE_TTL_SECONDS, () =>
            prisma.collection.findMany({
                where,
                orderBy: { deployedAtLedger: 'desc' },
            })
        );
        res.json(serialize(results));
    } catch (err) {
        console.error('Error details:', err);
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
        console.error('Error details:', err);
        res.status(500).json({ error: 'Failed to fetch creator collections' });
    }
});

// GET /wallets/:address/staked — active staked NFTs for a wallet
router.get('/wallets/:address/staked', async (req: Request, res: Response) => {
  const { address } = req.params;
  try {
    const staked = await prisma.stakedNFT.findMany({
      where: { owner: address as string, status: 'Active' },
      orderBy: { stakedAt: 'desc' },
    });
    res.json(serialize(staked));
  } catch (err) {
    console.error('Error details:', err);
    res.status(500).json({ error: 'Failed to fetch staked NFTs' });
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
        console.error('Error details:', err);
        res.status(500).json({ error: 'Failed to fetch wallet activity' });
    }
});

// GET /wallets/:address/royalty-stats — royalty income from resales (seller != original creator)
router.get('/wallets/:address/royalty-stats', strictRateLimiter, async (req: Request, res: Response) => {
    const { address } = req.params;
    try {
        const sold = await prisma.listing.findMany({
            where: {
                status: 'Sold',
                NOT: { artist: address as string },
            },
            select: {
                listingId: true,
                price: true,
                recipients: true,
                updatedAtLedger: true,
            },
        });

        let totalEarned = 0;
        let payoutCount = 0;
        let lastPayout = 0;

        for (const row of sold) {
            const recipients = (row.recipients as Array<{ address: string, percentage: number }>) || [];
            const recipient = recipients.find(r => r.address === address);
            if (recipient) {
                payoutCount++;
                const p = Number(row.price);
                totalEarned += (p * recipient.percentage) / 10000;
                if (row.updatedAtLedger > lastPayout) {
                    lastPayout = row.updatedAtLedger;
                }
            }
        }

        res.json({
            totalEarned: totalEarned.toFixed(7),
            payoutCount,
            lastPayout: lastPayout > 0 ? lastPayout * 1000 : 0,
        });
    } catch (err) {
        console.error('Error details:', err);
        res.status(500).json({ error: 'Failed to fetch royalty stats' });
    }
});

// GET /stats — marketplace-wide aggregates with optional time-range filtering
// Query params:
//   from  — ISO 8601 date string (inclusive lower bound), e.g. 2024-01-01
//   to    — ISO 8601 date string (inclusive upper bound), e.g. 2024-12-31
//   range — shorthand: "day" | "week" | "month" (overrides from/to)
router.get('/stats', async (req: Request, res: Response) => {
    try {
        const { from, to, range } = req.query;

        // Resolve time window
        let dateFrom: Date | undefined;
        let dateTo: Date | undefined;

        if (range) {
            const now = new Date();
            dateTo = now;
            if (range === 'day') {
                dateFrom = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            } else if (range === 'week') {
                dateFrom = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            } else if (range === 'month') {
                dateFrom = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            } else {
                return res.status(400).json({ error: 'Invalid range value. Use day, week, or month.' });
            }
        } else {
            if (from) {
                dateFrom = new Date(from as string);
                if (isNaN(dateFrom.getTime())) {
                    return res.status(400).json({ error: 'Invalid from date format. Use ISO 8601.' });
                }
            }
            if (to) {
                dateTo = new Date(to as string);
                if (isNaN(dateTo.getTime())) {
                    return res.status(400).json({ error: 'Invalid to date format. Use ISO 8601.' });
                }
            }
        }

        // Build ledgerTimestamp filter for time-ranged queries
        const eventTimeFilter: any = {};
        if (dateFrom) eventTimeFilter.gte = dateFrom;
        if (dateTo)   eventTimeFilter.lte = dateTo;
        const hasTimeFilter = Object.keys(eventTimeFilter).length > 0;

        // Total listings count
        const totalListings = await prisma.listing.count();

        // Active listings count
        const activeListings = await prisma.listing.count({
            where: { status: 'Active' },
        });

        // Total volume — sum of price for all Sold listings
        const volumeResult = await prisma.listing.aggregate({
            _sum: { price: true },
            where: { status: 'Sold' },
        });
        const totalVolume = volumeResult._sum.price?.toString() ?? '0';

        // Unique active users — distinct actors across marketplace events
        const userFilter: any = hasTimeFilter
            ? { ledgerTimestamp: eventTimeFilter }
            : {};
        const distinctActors = await prisma.marketplaceEvent.findMany({
            where: userFilter,
            select: { actor: true },
            distinct: ['actor'],
        });
        const activeUsers = distinctActors.length;

        // Event counts within the time window (or all-time if no filter)
        const totalEvents = await prisma.marketplaceEvent.count({
            where: userFilter,
        });

        // Sales count within time window
        const salesFilter: any = { eventType: 'ARTWORK_SOLD' };
        if (hasTimeFilter) salesFilter.ledgerTimestamp = eventTimeFilter;
        const totalSales = await prisma.marketplaceEvent.count({
            where: salesFilter,
        });

        // Volume within time window — sum price of sold listings whose updatedAt
        // falls in the window (using ledgerTimestamp from events as proxy)
        const windowVolumeResult = hasTimeFilter
            ? await prisma.listing.aggregate({
                _sum: { price: true },
                where: {
                    status: 'Sold',
                    // ledgerTimestamp is on MarketplaceEvent, not Listing — use
                    // an EXISTS sub-query approximation via a join on event time
                },
            })
            : null;

        res.json({
            totalListings,
            activeListings,
            totalVolume,
            activeUsers,
            totalEvents,
            totalSales,
            ...(hasTimeFilter && {
                timeRange: {
                    from: dateFrom?.toISOString() ?? null,
                    to: dateTo?.toISOString() ?? null,
                },
            }),
        });
    } catch (err) {
        console.error('Error details:', err);
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

export default router;
