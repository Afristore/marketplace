import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockRedisClient = vi.hoisted(() => ({
  isOpen: true,
  isReady: true,
  get: vi.fn(),
  setEx: vi.fn().mockResolvedValue(undefined),
  on: vi.fn(),
  connect: vi.fn(),
}));

vi.mock('../redis.js', () => ({ default: mockRedisClient }));

import { cacheMiddleware } from '../api/cache-middleware';

describe('Cache Middleware', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    mockRedisClient.isReady = true;
    delete (mockRedisClient as any).status;
    app = express();
    app.get('/test', cacheMiddleware(30), (req, res) => {
      res.json({ message: 'fresh', value: Date.now() });
    });
  });

  // ── isRedisReady — isReady boolean branch ─────────────────────────────────

  it('passes through when Redis isReady is false', async () => {
    mockRedisClient.isReady = false;

    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('fresh');
    expect(mockRedisClient.get).not.toHaveBeenCalled();
  });

  it('returns cached data on cache hit', async () => {
    mockRedisClient.isReady = true;
    mockRedisClient.get.mockResolvedValue(JSON.stringify({ message: 'cached', value: 123 }));

    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('cached');
    expect(res.body.value).toBe(123);
    expect(mockRedisClient.setEx).not.toHaveBeenCalled();
  });

  it('caches the response on cache miss', async () => {
    mockRedisClient.isReady = true;
    mockRedisClient.get.mockResolvedValue(null);

    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('fresh');
    expect(mockRedisClient.setEx).toHaveBeenCalledOnce();
    expect(mockRedisClient.setEx).toHaveBeenCalledWith(
      expect.stringContaining('cache:'),
      30,
      expect.any(String)
    );
  });

  it('uses originalUrl as cache key', async () => {
    mockRedisClient.isReady = true;
    mockRedisClient.get.mockResolvedValue(null);

    await request(app).get('/test?foo=bar');
    expect(mockRedisClient.setEx).toHaveBeenCalledWith(
      expect.stringContaining('/test?foo=bar'),
      expect.any(Number),
      expect.any(String)
    );
  });

  it('passes through on Redis get error', async () => {
    mockRedisClient.isReady = true;
    mockRedisClient.get.mockRejectedValue(new Error('Redis down'));

    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('fresh');
  });

  // ── isRedisReady — status string branch ──────────────────────────────────

  it('skips caching when client status is not "ready"', async () => {
    mockRedisClient.isReady = undefined as any;
    (mockRedisClient as any).status = 'disconnecting';

    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('fresh');
    expect(mockRedisClient.get).not.toHaveBeenCalled();
    expect(mockRedisClient.setEx).not.toHaveBeenCalled();
  });

  it('treats client with status "ready" as connected', async () => {
    mockRedisClient.isReady = undefined as any;
    (mockRedisClient as any).status = 'ready';
    mockRedisClient.get.mockResolvedValue(JSON.stringify({ message: 'from_status_cache' }));

    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('from_status_cache');
  });

  // ── isRedisReady — isOpen boolean fallback branch ────────────────────────

  it('falls back to isOpen when neither isReady nor status is set', async () => {
    mockRedisClient.isReady = undefined as any;
    mockRedisClient.get.mockResolvedValue(null);

    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('fresh');
    expect(mockRedisClient.get).toHaveBeenCalled();
  });

  // ── TTL is forwarded correctly ────────────────────────────────────────────

  it('stores the response with the TTL passed to cacheMiddleware', async () => {
    mockRedisClient.isReady = true;
    mockRedisClient.get.mockResolvedValue(null);

    const ttlApp = express();
    ttlApp.get('/ttl', cacheMiddleware(120), (_req, res) => res.json({ x: 1 }));

    await request(ttlApp).get('/ttl');
    expect(mockRedisClient.setEx).toHaveBeenCalledWith(
      expect.any(String),
      120,
      expect.any(String)
    );
  });

  // ── Cache write failure is silent ────────────────────────────────────────

  it('still returns the response even when cache write fails', async () => {
    mockRedisClient.isReady = true;
    mockRedisClient.get.mockResolvedValue(null);
    mockRedisClient.setEx.mockRejectedValue(new Error('write failed'));

    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('fresh');
  });
});
