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
 * JSON replacer that serialises `bigint` values as decimal strings.
 *
 * Prisma returns `BigInt` columns (e.g. `listingId`, `tokenId`) as native
 * `bigint`, which `JSON.stringify` rejects with
 * `TypeError: Do not know how to serialize a BigInt` (#1245).
 */
export function bigIntReplacer(_key: string, value: unknown): unknown {
    return typeof value === 'bigint' ? value.toString() : value;
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
                // Serialise once, BigInt-safe, and send exactly the string
                // that is cached, so a cache hit returns the same body as the
                // original miss. Express's own res.json would throw on BigInt.
                let body: string | undefined;
                try {
                    body = JSON.stringify(data, bigIntReplacer);
                } catch (err: unknown) {
                    // Unserialisable (e.g. circular): don't cache, and let
                    // Express handle the response as it would without us.
                    console.error('Failed to serialise response for cache:', err);
                    return originalJson(data);
                }

                if (body === undefined) {
                    return originalJson(data);
                }

                client.setEx(cacheKey, ttl, body).catch((err: unknown) => {
                    console.error('Failed to cache data:', err);
                });

                if (!res.get('Content-Type')) {
                    res.set('Content-Type', 'application/json; charset=utf-8');
                }
                return res.send(body);
            };

            next();
        } catch (err: unknown) {
            console.error('Cache middleware error:', err);
            next();
        }
    };
};
