import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const redis = new Redis(REDIS_URL, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
});

redis.on('error', (err) => {
    console.warn('[Redis] Connection error (caching disabled):', err.message);
});

redis.connect().catch((err) => {
    console.warn('[Redis] Could not connect (caching disabled):', err.message);
});

export default redis;
