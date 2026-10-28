import { Request, Response, NextFunction } from 'express';
import redisClient from '../redis.js';

function isRedisReady(client: any) {
    if (typeof client?.isReady === 'boolean') {
        return client.isReady;
    }

    if (typeof client?.status === 'string') {
        return client.status === 'ready';
    }

    return Boolean(client?.isOpen);
}

/**
 * Cache middleware with TTL support
 * @param ttl Time-to-live in seconds
 */
export const cacheMiddleware = (ttl: number) => {
    return async (req: Request, res: Response, next: NextFunction) => {
        // Skip caching if Redis is not connected
        const client = redisClient as any;
        if (!isRedisReady(client)) {
            return next();
        }

        const cacheKey = `cache:${req.originalUrl || req.url}`;

        try {
            const cachedData = await client.get(cacheKey);

            if (cachedData) {
                return res.json(JSON.parse(cachedData));
            }

            const originalJson = res.json.bind(res);

            res.json = function (data: any) {
                client.setEx(cacheKey, ttl, JSON.stringify(data)).catch((err: unknown) => {
                    console.error('Failed to cache data:', err);
                });
                return originalJson(data);
            };

            next();
        } catch (err: unknown) {
            console.error('Cache middleware error:', err);
            next();
        }
    };
};
