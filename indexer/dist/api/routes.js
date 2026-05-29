"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_js_1 = __importDefault(require("../db.js"));
const cache_middleware_js_1 = require("./cache-middleware.js");
const rate_limit_middleware_js_1 = require("./rate-limit-middleware.js");
const router = (0, express_1.Router)();
// Helper to serialize BigInts to strings for JSON
const serialize = (obj) => JSON.parse(JSON.stringify(obj, (key, value) => typeof value === 'bigint' ? value.toString() : value));
// GET /listings?artist= — all listings created by an artist
router.get('/listings', async (req, res) => {
    const { artist, owner } = req.query;
    try {
        const where = {};
        if (artist)
            where.artist = artist;
        if (owner)
            where.owner = owner;
        const results = await db_js_1.default.listing.findMany({
            where,
            orderBy: { updatedAtLedger: 'desc' },
        });
        res.json(serialize(results));
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to fetch listings' });
    }
});
// GET /listings/:id/history — full event timeline for a single listing
router.get('/listings/:id/history', async (req, res) => {
    const id = req.params.id;
    if (!/^\d+$/.test(id)) {
        return res.status(400).json({ error: 'Invalid ID format' });
    }
    try {
        const results = await db_js_1.default.marketplaceEvent.findMany({
            where: { listingId: BigInt(id) },
            orderBy: { ledgerSequence: 'asc' },
        });
        res.json(serialize(results));
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to fetch listing history' });
    }
});
// GET /auctions — all active or finished auctions
router.get('/auctions', async (req, res) => {
    const { creator, status } = req.query;
    try {
        const where = {};
        if (creator)
            where.creator = creator;
        if (status)
            where.status = status;
        const results = await db_js_1.default.auction.findMany({
            where,
            orderBy: { updatedAtLedger: 'desc' },
        });
        res.json(serialize(results));
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to fetch auctions' });
    }
});
// GET /auctions/:id — a single auction by ID
router.get('/auctions/:id', async (req, res) => {
    const id = req.params.id;
    if (!/^\d+$/.test(id)) {
        return res.status(400).json({ error: 'Invalid ID format' });
    }
    try {
        const result = await db_js_1.default.auction.findUnique({
            where: { auctionId: BigInt(id) },
        });
        if (!result) {
            return res.status(404).json({ error: 'Auction not found' });
        }
        res.json(serialize(result));
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to fetch auction' });
    }
});
// GET /offers — all offers for a listing
router.get('/offers', async (req, res) => {
    const { listing_id } = req.query;
    try {
        const where = {};
        if (listing_id) {
            if (!/^\d+$/.test(listing_id)) {
                return res.status(400).json({ error: 'Invalid listing_id format' });
            }
            where.listingId = BigInt(listing_id);
        }
        const results = await db_js_1.default.offer.findMany({
            where,
            orderBy: { updatedAtLedger: 'desc' },
        });
        res.json(serialize(results));
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to fetch offers' });
    }
});
// GET /activity/recent — latest sales and listings across the marketplace
// Cache for 30 seconds to handle traffic spikes
router.get('/activity/recent', (0, cache_middleware_js_1.cacheMiddleware)(30), async (req, res) => {
    try {
        const results = await db_js_1.default.marketplaceEvent.findMany({
            take: 20,
            orderBy: { ledgerSequence: 'desc' },
        });
        res.json(serialize(results));
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to fetch recent activity' });
    }
});
// GET /collections — all deployed collections
// Cache for 60 seconds to handle traffic spikes
router.get('/collections', (0, cache_middleware_js_1.cacheMiddleware)(60), async (req, res) => {
    const { kind, creator } = req.query;
    try {
        const where = {};
        if (kind)
            where.kind = kind;
        if (creator)
            where.creator = creator;
        const results = await db_js_1.default.collection.findMany({
            where,
            orderBy: { deployedAtLedger: 'desc' },
        });
        res.json(serialize(results));
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to fetch collections' });
    }
});
// GET /creators/:address/collections — collections deployed by a creator
router.get('/creators/:address/collections', async (req, res) => {
    const { address } = req.params;
    try {
        const results = await db_js_1.default.collection.findMany({
            where: { creator: address },
            orderBy: { deployedAtLedger: 'desc' },
        });
        res.json(serialize(results));
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to fetch creator collections' });
    }
});
// GET /wallets/:address/activity — events relevant to a Stellar account
router.get('/wallets/:address/activity', rate_limit_middleware_js_1.strictRateLimiter, async (req, res) => {
    const address = req.params.address;
    const take = Math.min(parseInt(String(req.query.limit || '50'), 10) || 50, 200);
    try {
        const jsonKeys = ['buyer', 'artist', 'offerer', 'bidder', 'winner', 'creator'];
        const fromJson = jsonKeys.map((path) => ({
            data: { path: [path], equals: address },
        }));
        const events = await db_js_1.default.marketplaceEvent.findMany({
            where: {
                OR: [{ actor: address }, ...fromJson],
            },
            orderBy: { ledgerSequence: 'desc' },
            take,
        });
        res.json(serialize(events));
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to fetch wallet activity' });
    }
});
// GET /wallets/:address/royalty-stats — aggregates royalty-bearing sales for an artist
router.get('/wallets/:address/royalty-stats', rate_limit_middleware_js_1.strictRateLimiter, async (req, res) => {
    const { address } = req.params;
    try {
        const sold = await db_js_1.default.listing.findMany({
            where: { artist: address, status: 'Sold' },
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
        const lastEvent = await db_js_1.default.marketplaceEvent.findFirst({
            where: { eventType: 'ARTWORK_SOLD', actor: address },
            orderBy: { ledgerSequence: 'desc' },
        });
        res.json({
            totalEarned: totalEarned.toFixed(7),
            payoutCount: sold.length,
            lastPayout: lastEvent?.ledgerTimestamp
                ? new Date(lastEvent.ledgerTimestamp).getTime()
                : 0,
        });
    }
    catch (err) {
        res.status(500).json({ error: 'Failed to fetch royalty stats' });
    }
});
exports.default = router;
