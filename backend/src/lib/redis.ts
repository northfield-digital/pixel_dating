import { createClient, RedisClientType } from 'redis';

let client: RedisClientType | null = null;
let initialised = false;

/**
 * Returns a connected Redis client, or null if REDIS_URL is not configured
 * or the connection fails. Safe to call repeatedly.
 *
 * Used for distributed rate limiting and (future) job queues. When null,
 * callers should fall back to in-process behaviour and log a warning so
 * operators know the deployment is not safe to scale horizontally.
 */
export async function getRedis(): Promise<RedisClientType | null> {
  if (initialised) return client;
  initialised = true;

  const url = process.env.REDIS_URL;
  if (!url) {
    console.warn('[redis] REDIS_URL not set — rate limiting and email retries will be in-process only. Do NOT run multiple replicas.');
    return null;
  }

  try {
    const c: RedisClientType = createClient({ url });
    c.on('error', (err) => console.error('[redis] client error:', err));
    await c.connect();
    client = c;
    console.log('[redis] connected');
    return client;
  } catch (err) {
    console.error('[redis] failed to connect, falling back to in-process behaviour:', err);
    client = null;
    return null;
  }
}

export async function closeRedis(): Promise<void> {
  if (client) {
    try { await client.quit(); } catch { /* noop */ }
    client = null;
    initialised = false;
  }
}
