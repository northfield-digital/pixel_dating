import 'dotenv/config';
// Sentry must be imported BEFORE any other instrumented module so its
// hooks attach to express/http. Init is a no-op when SENTRY_DSN isn't set.
import { Sentry, sentryEnabled } from './lib/sentry.js';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import morgan from 'morgan';

import registerRouter from './routes/register.js';
import stripeRouter from './routes/stripe.js';
import mapRouter from './routes/map.js';
import pixelRouter from './routes/pixel.js';
import likeRouter from './routes/like.js';
import userRouter from './routes/user.js';
import citiesRouter from './routes/cities.js';
import eventRouter from './routes/event.js';
import { startConnectionExpiryCron } from './services/connectionExpiry.js';
import devRouter from './routes/dev.js';
import { pool } from './db/index.js';
import { initRateLimiters, makeLimiter } from './lib/rateLimit.js';
import { closeRedis, getRedis } from './lib/redis.js';

// ─── Env validation ──────────────────────────────────────────────────────────

const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET', 'EMAIL_ENCRYPTION_KEY', 'EMAIL_HASH_KEY', 'FRONTEND_URL', 'BACKEND_URL'] as const;
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}
if ((process.env.JWT_SECRET ?? '').length < 32) {
  console.error('JWT_SECRET must be at least 32 characters');
  process.exit(1);
}
if ((process.env.EMAIL_ENCRYPTION_KEY ?? '').length < 32) {
  console.error('EMAIL_ENCRYPTION_KEY must be at least 32 characters');
  process.exit(1);
}
if ((process.env.EMAIL_HASH_KEY ?? '').length < 32) {
  console.error('EMAIL_HASH_KEY must be at least 32 characters');
  process.exit(1);
}

const isProduction = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3001;
const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS || '30000', 10);

async function main() {
  await initRateLimiters();

  const app = express();

  // ─── Trust proxy ───────────────────────────────────────────────────────────
  // Number of proxy hops in front of the app. MUST match the actual
  // deployment topology, otherwise rate limiting can be bypassed by
  // spoofing X-Forwarded-For. Default 1 (single load balancer).
  const trustProxy = parseInt(process.env.TRUST_PROXY_HOPS || '1', 10);
  app.set('trust proxy', trustProxy);

  // ─── Security headers ──────────────────────────────────────────────────────
  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://api.mapbox.com', 'https://js.stripe.com'],
        connectSrc: [
          "'self'",
          'https://api.mapbox.com',
          'https://events.mapbox.com',
          'https://api.stripe.com',
          'https://ipapi.co',
        ],
        imgSrc: ["'self'", 'data:', 'blob:', 'https://api.mapbox.com', 'https://*.tiles.mapbox.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://api.mapbox.com'],
        workerSrc: ["'self'", 'blob:'],
        fontSrc: ["'self'", 'data:'],
        frameSrc: ["'self'", 'https://js.stripe.com', 'https://hooks.stripe.com'],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    hsts: isProduction ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // map tiles
    referrerPolicy: { policy: 'no-referrer' },
  }));

  // ─── Request logging ───────────────────────────────────────────────────────
  // Custom token that strips ?token=… from the URL so verification tokens
  // don't end up in our log files.
  morgan.token('safeurl', (req) => {
    const url = (req as Request).originalUrl ?? '';
    return url.replace(/(token=)[^&]+/i, '$1[redacted]');
  });
  app.use(morgan(':method :safeurl :status :res[content-length] - :response-time ms'));

  // ─── Request timeout ───────────────────────────────────────────────────────
  app.use((req: Request, res: Response, next: NextFunction) => {
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      if (!res.headersSent) res.status(503).json({ error: 'Request timeout' });
    });
    next();
  });

  // ─── CORS ──────────────────────────────────────────────────────────────────
  app.use(cors({
    origin: process.env.FRONTEND_URL,
    credentials: true,
  }));

  app.use(cookieParser());

  // Stripe webhook MUST receive raw body — register before express.json()
  // and bound the body size so a malicious caller cannot exhaust memory.
  app.use('/api/stripe/webhook', express.raw({ type: 'application/json', limit: '1mb' }));

  // JSON body parsing for all other routes — bounded.
  app.use(express.json({ limit: '32kb' }));

  // ─── Rate Limiters ─────────────────────────────────────────────────────────
  const registerLimiter = makeLimiter({ prefix: 'register', windowMs: 60_000, max: 5 });
  const likeLimiter     = makeLimiter({ prefix: 'like',     windowMs: 60_000, max: 20 });
  const previewLimiter  = makeLimiter({ prefix: 'preview',  windowMs: 60_000, max: 60 });
  const placeLimiter    = makeLimiter({ prefix: 'place',    windowMs: 60_000, max: 10 });
  const authLimiter     = makeLimiter({ prefix: 'auth',     windowMs: 60_000, max: 10 });
  const userLimiter     = makeLimiter({ prefix: 'user',     windowMs: 60_000, max: 30 });
  const connLimiter     = makeLimiter({ prefix: 'conn',     windowMs: 60_000, max: 20 });
  const mapLimiter      = makeLimiter({ prefix: 'map',      windowMs: 60_000, max: 120 });
  const citiesLimiter   = makeLimiter({ prefix: 'cities',   windowMs: 60_000, max: 30 });
  const eventLimiter    = makeLimiter({ prefix: 'event',    windowMs: 60_000, max: 30 });

  // Per-token limiter on email verification: each verify_token may be
  // attempted at most 5 times / minute. This makes brute force unattractive
  // even if someone grabs the URL pattern. Requests without a token field
  // get keyed under a single shared bucket, which is fine because they'll
  // be rejected by the route handler anyway.
  const verifyEmailLimiter = makeLimiter({
    prefix: 'verifyEmail',
    windowMs: 60_000,
    max: 5,
    keyGenerator: (req) => `t:${String(req.query.token ?? 'missing').slice(0, 64)}`,
  });

  // ─── Routes ────────────────────────────────────────────────────────────────
  app.use('/api/register', registerLimiter, registerRouter);
  app.use('/api/auth/verify-email', verifyEmailLimiter); // tighter per-token limit first
  app.use('/api/auth', authLimiter, registerRouter);     // verify-email lives here too
  app.use('/api/stripe', stripeRouter);
  app.use('/api/map', mapLimiter, mapRouter);
  app.use('/api/pixel', previewLimiter, mapRouter);   // pixel preview via mapRouter
  app.use('/api/pixel', placeLimiter, pixelRouter);   // validate + place via pixelRouter
  app.use('/api/like', likeLimiter, likeRouter);
  app.use('/api/connection', connLimiter, likeRouter);
  app.use('/api/user', userLimiter, userRouter);
  app.use('/api/cities', citiesLimiter, citiesRouter);
  app.use('/api/event', eventLimiter, eventRouter);

  // Dev-only routes — gated at startup AND at every request (see dev.ts).
  if (!isProduction) {
    app.use('/api/dev', devRouter);
    console.log('⚠️  Dev routes enabled: /api/dev/activate, /api/dev/seed-bots, /api/dev/wipe-bots');
  }

  // Liveness — process is up and event loop responsive. Used by the
  // platform (Fly/Render/etc.) to decide whether to restart the container.
  // Must be cheap — no DB or Redis calls here.
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime_s: Math.round(process.uptime()) });
  });

  // Readiness — process is ready to serve traffic. Checks downstream
  // dependencies. Used by the load balancer to decide whether to send
  // requests. May fail temporarily without restarting the container.
  app.get('/ready', async (_req, res) => {
    const checks: Record<string, 'ok' | 'error'> = { db: 'ok', redis: 'ok' };
    try {
      await pool.query('SELECT 1');
    } catch {
      checks.db = 'error';
    }
    // Redis is optional; only report error if REDIS_URL was supplied and
    // we can't reach it.
    if (process.env.REDIS_URL) {
      try {
        const c = await getRedis();
        if (!c) checks.redis = 'error';
        else await c.ping();
      } catch {
        checks.redis = 'error';
      }
    } else {
      checks.redis = 'ok'; // not configured, count as ok
    }
    const ok = checks.db === 'ok' && checks.redis === 'ok';
    res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'error', checks });
  });

  // 404 catch-all
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // Sentry's express error handler captures 5xx errors with request
  // context. Must be registered BEFORE our own error handler. No-op when
  // Sentry isn't initialised.
  if (sentryEnabled) {
    Sentry.setupExpressErrorHandler(app);
  }

  // Global error handler — never leak the underlying error to the client.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  });

  // ─── Start ────────────────────────────────────────────────────────────────
  const server = app.listen(PORT, () => {
    console.log(`Backend running on port ${PORT}`);

    // Cron is opt-in to avoid duplicate work in multi-replica deployments.
    // - Single-instance deployments: set ENABLE_CRON=true.
    // - Multi-replica + Redis: set ENABLE_CRON=true; the Redis lock in
    //   connectionExpiry.ts ensures only one replica runs each tick.
    // - Multi-replica without Redis: deploy a dedicated worker instance
    //   with ENABLE_CRON=true and keep it false on web instances.
    const enableCron = process.env.ENABLE_CRON === 'true' || (!isProduction && process.env.ENABLE_CRON !== 'false');
    if (enableCron) {
      startConnectionExpiryCron();
      console.log('Cron jobs started');
    } else {
      console.log('Cron jobs disabled (set ENABLE_CRON=true on a single worker)');
    }
  });

  // ─── Graceful shutdown ────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    console.log(`${signal} received, shutting down...`);
    server.close(() => console.log('HTTP server closed'));
    try { await pool.end(); } catch { /* noop */ }
    try { await closeRedis(); } catch { /* noop */ }
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT',  () => void shutdown('SIGINT'));

  return app;
}

const appPromise = main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

export default appPromise;
