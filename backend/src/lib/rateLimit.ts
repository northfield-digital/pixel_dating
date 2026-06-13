import { rateLimit, Options } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { getRedis } from './redis.js';

/**
 * Build a rate limiter. If Redis is configured (REDIS_URL), uses a shared
 * Redis store so limits work correctly behind a load balancer with multiple
 * backend replicas. Otherwise falls back to the default in-memory store.
 *
 * Call `await initRateLimiters()` once at startup before mounting routes
 * so the Redis connection is established before requests come in.
 */
export interface LimiterConfig extends Partial<Options> {
  prefix: string;
  windowMs: number;
  max: number;
}

let redisReady = false;

export async function initRateLimiters(): Promise<void> {
  const client = await getRedis();
  redisReady = client !== null;
}

export function makeLimiter(cfg: LimiterConfig) {
  const { prefix, ...rest } = cfg;
  const opts: Partial<Options> = {
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    ...rest,
  };

  if (redisReady) {
    // sendCommand needs to call into the connected client; we can't import
    // the client at module load (it's async), so we resolve it lazily.
    opts.store = new RedisStore({
      prefix: `rl:${prefix}:`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sendCommand: async (...args: string[]) => {
        const c = await getRedis();
        if (!c) throw new Error('Redis unavailable');
        // node-redis v4 generic command
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (c as any).sendCommand(args);
      },
    });
  }

  return rateLimit(opts);
}
