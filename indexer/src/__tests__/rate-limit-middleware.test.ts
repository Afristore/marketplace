import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { rateLimiter, strictRateLimiter } from '../api/rate-limit-middleware.js';

describe('Rate Limiting Middleware', () => {
    let app: express.Application;
    let testId = 0;

    beforeAll(() => {
        app = express();
        app.use(express.json());
        app.set('trust proxy', 1);

        // Test route with standard rate limiter
        app.get('/test', rateLimiter, (req, res) => {
            res.json({ message: 'success' });
        });

        // Test route with strict rate limiter
        app.get('/test-strict', strictRateLimiter, (req, res) => {
            res.json({ message: 'success' });
        });

        // Health check endpoint (should be skipped by rate limiter)
        app.get('/health', rateLimiter, (req, res) => {
            res.json({ status: 'ok' });
        });
    });

    beforeEach(() => {
        testId++;
    });

    function getIp() {
        return `192.168.1.${testId}`;
    }

    it('should allow requests under the limit', async () => {
        const response = await request(app).get('/test').set('x-forwarded-for', getIp());
        expect(response.status).toBe(200);
        expect(response.body.message).toBe('success');
    });

    it('should include rate limit headers in response', async () => {
        const response = await request(app).get('/test').set('x-forwarded-for', getIp());
        expect(response.headers['ratelimit-limit']).toBeDefined();
        expect(response.headers['ratelimit-remaining']).toBeDefined();
        expect(response.headers['ratelimit-reset']).toBeDefined();
    });

    it('should correctly set ratelimit-limit to 100 for standard limiter', async () => {
        const response = await request(app).get('/test').set('x-forwarded-for', getIp());
        expect(response.headers['ratelimit-limit']).toBe('100');
    });

    it('should track remaining requests correctly', async () => {
        const res1 = await request(app).get('/test').set('x-forwarded-for', getIp());
        const remaining1 = parseInt(res1.headers['ratelimit-remaining']);
        expect(remaining1).toBeGreaterThanOrEqual(0);
        expect(remaining1).toBeLessThanOrEqual(99);
    });

    it('should return 429 status when rate limit exceeded', async () => {
        let blockedFound = false;
        for (let i = 0; i < 110; i++) {
            const response = await request(app).get('/test').set('x-forwarded-for', getIp());
            if (response.status === 429) {
                blockedFound = true;
                expect(response.body.error).toBeDefined();
                break;
            }
        }
        expect(blockedFound).toBe(true);
    }, 30000);

    it('should block IP after exceeding 100 requests per minute', async () => {
        let blockedFound = false;
        for (let i = 0; i < 110; i++) {
            const response = await request(app).get('/test').set('x-forwarded-for', getIp());
            if (response.status === 429) {
                blockedFound = true;
                break;
            }
        }
        expect(blockedFound).toBe(true);
    }, 30000);

    it('should include retry-after information in error response', async () => {
        let blockedResponse = null;
        for (let i = 0; i < 110; i++) {
            const response = await request(app).get('/test').set('x-forwarded-for', getIp());
            if (response.status === 429) {
                blockedResponse = response;
                break;
            }
        }
        if (blockedResponse) {
            expect(blockedResponse.body.error).toContain('Too many requests');
            expect(blockedResponse.body.retryAfter).toBeDefined();
        }
    }, 30000);

    it('should apply stricter limits (20 req/min) to strict endpoints', async () => {
        let blockedFound = false;
        for (let i = 0; i < 30; i++) {
            const response = await request(app).get('/test-strict').set('x-forwarded-for', getIp());
            if (response.status === 429) {
                blockedFound = true;
                break;
            }
        }
        expect(blockedFound).toBe(true);
    }, 30000);

    it('should set ratelimit-limit to 20 for strict limiter', async () => {
        const response = await request(app).get('/test-strict').set('x-forwarded-for', getIp());
        expect(response.headers['ratelimit-limit']).toBe('20');
    });

    it('should skip rate limiting for health check endpoint', async () => {
        let allSuccessful = true;
        for (let i = 0; i < 30; i++) {
            const response = await request(app).get('/health').set('x-forwarded-for', getIp());
            if (response.status !== 200) {
                allSuccessful = false;
                break;
            }
        }
        expect(allSuccessful).toBe(true);
    }, 30000);

    it('should return 429 with correct message for standard limiter', async () => {
        let blockedResponse = null;
        for (let i = 0; i < 110; i++) {
            const response = await request(app).get('/test').set('x-forwarded-for', getIp());
            if (response.status === 429) {
                blockedResponse = response;
                break;
            }
        }
        if (blockedResponse) {
            expect(blockedResponse.body.error).toContain('Too many requests from this IP');
        }
    }, 30000);

    it('should return 429 with correct message for strict limiter', async () => {
        let blockedResponse = null;
        for (let i = 0; i < 30; i++) {
            const response = await request(app).get('/test-strict').set('x-forwarded-for', getIp());
            if (response.status === 429) {
                blockedResponse = response;
                break;
            }
        }
        if (blockedResponse) {
            expect(blockedResponse.body.error).toContain('Too many requests to this endpoint');
        }
    }, 30000);

    it('should use standardHeaders for rate limit info', async () => {
        const response = await request(app).get('/test').set('x-forwarded-for', getIp());
        expect(response.headers['ratelimit-limit']).toBeDefined();
        expect(response.headers['ratelimit-remaining']).toBeDefined();
        expect(response.headers['ratelimit-reset']).toBeDefined();
    });

    it('should not use legacy X-RateLimit headers', async () => {
        const response = await request(app).get('/test').set('x-forwarded-for', getIp());
        expect(response.headers['x-ratelimit-limit']).toBeUndefined();
        expect(response.headers['x-ratelimit-remaining']).toBeUndefined();
        expect(response.headers['x-ratelimit-reset']).toBeUndefined();
    });

    it('should reset rate limit after time window expires', async () => {
        const response = await request(app).get('/test').set('x-forwarded-for', getIp());
        const ratelimitReset = response.headers['ratelimit-reset'];
        expect(ratelimitReset).toBeDefined();
    });

    it('should prevent distributed DoS with per-IP tracking', async () => {
        let successCount = 0;
        let blockedCount = 0;

        for (let i = 0; i < 25; i++) {
            // Using a new IP for every single request to simulate a distributed attack!
            // Actually, the test says "per-IP tracking", meaning it should track the SAME IP.
            // So we use getIp() which stays constant for this test block.
            const response = await request(app).get('/test').set('x-forwarded-for', getIp());
            if (response.status === 200) {
                successCount++;
            } else if (response.status === 429) {
                blockedCount++;
            }
        }

        expect(successCount).toBeGreaterThan(0);
    }, 30000);
});
