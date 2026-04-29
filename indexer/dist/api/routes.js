"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_js_1 = __importDefault(require("../db.js"));
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
    const { id } = req.params;
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
// GET /activity/recent — latest sales and listings across the marketplace
router.get('/activity/recent', async (req, res) => {
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
router.get('/collections', async (req, res) => {
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
router.get('/wallets/:address/activity', async (req, res) => {
    const { address } = req.params;
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
router.get('/wallets/:address/royalty-stats', async (req, res) => {
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
