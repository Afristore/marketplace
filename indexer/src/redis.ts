import { createClient, RedisClientType } from 'redis';

// Create Redis client but do NOT connect eagerly. Connection will be lazy.
const rawClient: RedisClientType = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
});

rawClient.on('error', (err) => {
    console.error('Redis Client Error:', err);
});

let connecting: Promise<void> | null = null;

async function ensureConnected(): Promise<void> {
    if (rawClient.isOpen) return;
    if (connecting) return connecting;
    connecting = rawClient.connect().then(() => {
        console.log('✓ Redis connected');
    }).catch((err) => {
        console.error('Failed to connect to Redis:', err);
    }).finally(() => {
        connecting = null;
    });
    return connecting;
}

// Export a small wrapper that mirrors the Redis client shape used in the codebase/tests.
const redisClient = {
    // Reflect whether the underlying client is open
    get isOpen() {
        return rawClient.isOpen;
    },
    // Trigger connection attempt but don't block callers (lazy connect)
    connect: () => ensureConnected(),
    isReady: () => rawClient.isOpen,
    // Common Redis operations used by the indexer. If not connected, behave gracefully.
    async get(key: string) {
        if (!rawClient.isOpen) return null;
        return rawClient.get(key);
    },
    async setEx(key: string, ttl: number, value: string) {
        if (!rawClient.isOpen) return null;
        return rawClient.setEx(key, ttl, value);
    },
    async del(key: string | string[]) {
        if (!rawClient.isOpen) return null;
        // @ts-ignore
        return rawClient.del(key as any);
    },
    async keys(pattern: string) {
        if (!rawClient.isOpen) return [];
        return rawClient.keys(pattern);
    },
};

export default redisClient;
