import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

const mockRedisClient = vi.hoisted(() => ({
  isOpen: true,
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
    app = express();
    app.get('/test', cacheMiddleware(30), (req, res) => {
      res.json({ message: 'fresh', value: Date.now() });
    });
  });

  it('passes through when Redis is not connected', async () => {
    mockRedisClient.isOpen = false;

    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('fresh');
    expect(mockRedisClient.get).not.toHaveBeenCalled();
  });

  it('returns cached data on cache hit', async () => {
    mockRedisClient.isOpen = true;
    mockRedisClient.get.mockResolvedValue(JSON.stringify({ message: 'cached', value: 123 }));

    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('cached');
    expect(res.body.value).toBe(123);
    expect(mockRedisClient.setEx).not.toHaveBeenCalled();
  });

  it('caches the response on cache miss', async () => {
    mockRedisClient.isOpen = true;
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
    mockRedisClient.isOpen = true;
    mockRedisClient.get.mockResolvedValue(null);

    await request(app).get('/test?foo=bar');
    expect(mockRedisClient.setEx).toHaveBeenCalledWith(
      expect.stringContaining('/test?foo=bar'),
      expect.any(Number),
      expect.any(String)
    );
  });

  it('passes through on Redis error', async () => {
    mockRedisClient.isOpen = true;
    mockRedisClient.get.mockRejectedValue(new Error('Redis down'));

    const res = await request(app).get('/test');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('fresh');
  });
});
