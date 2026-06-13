import cron from 'node-cron';
import { withTransaction, query } from '../db/index.js';
import { sendLikeExpiredEmail } from '../emails/likeExpired.js';
import { sendPixelExpiredEmail } from '../emails/pixelExpired.js';
import { queueEmail } from '../lib/emailQueue.js';
import { getRedis } from '../lib/redis.js';

/**
 * Acquire a short Redis lock so only one replica runs the cron tick.
 * Returns true if this instance got the lock, false otherwise. When
 * Redis is not configured every replica will run the tick — operators
 * must therefore set ENABLE_CRON=false on all-but-one instance, OR
 * configure REDIS_URL.
 */
async function acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
  const redis = await getRedis();
  if (!redis) return true; // no redis: caller is responsible (see ENABLE_CRON)
  try {
    const res = await redis.set(key, process.pid.toString(), { NX: true, EX: ttlSeconds });
    return res === 'OK';
  } catch (err) {
    console.error('[cron] redis lock error:', err);
    return false;
  }
}

export function startConnectionExpiryCron() {
  // ─── Connection expiry (every 15 minutes) ──────────────────────────────────
  cron.schedule('*/15 * * * *', async () => {
    if (!(await acquireLock('lock:cron:connectionExpiry', 14 * 60))) return;
    try {
      // Expire connections atomically and snapshot the affected rows so
      // we don't double-decrement likes_pending if the respond endpoint
      // races us.
      const expired = await withTransaction(async (client) => {
        const sel = await client.query(
          `SELECT id, clicker_id, clicked_id FROM connections
           WHERE status = 'pending' AND expires_at < now()
           FOR UPDATE SKIP LOCKED`,
          []
        );
        if (sel.rows.length === 0) return [] as Array<{ id: string; clicker_id: string; clicked_id: string }>;

        const ids = sel.rows.map((r) => r.id);
        await client.query(
          `UPDATE connections SET status = 'expired' WHERE id = ANY($1::uuid[])`,
          [ids]
        );

        // Group decrement counts per clicked user (one UPDATE per user).
        const perUser = new Map<string, number>();
        for (const r of sel.rows) {
          perUser.set(r.clicked_id, (perUser.get(r.clicked_id) ?? 0) + 1);
        }
        for (const [userId, n] of perUser) {
          await client.query(
            `UPDATE users SET likes_pending = GREATEST(0, likes_pending - $2) WHERE id = $1`,
            [userId, n]
          );
        }
        return sel.rows as Array<{ id: string; clicker_id: string; clicked_id: string }>;
      });

      for (const conn of expired) {
        const clickerRes = await query(
          `SELECT pgp_sym_decrypt(u.email, $2) AS email, u.country_code AS city_name, u.lang
           FROM users u
           WHERE u.id = $1 AND u.deleted_at IS NULL`,
          [conn.clicker_id, process.env.EMAIL_ENCRYPTION_KEY]
        );
        if (clickerRes.rows.length > 0) {
          const { email, city_name, lang } = clickerRes.rows[0];
          queueEmail('likeExpired', () => sendLikeExpiredEmail(email, city_name, lang));
        }
      }

      if (expired.length > 0) {
        console.log(`[cron] Expired ${expired.length} connections`);
      }
    } catch (err) {
      console.error('[cron] connectionExpiry error:', err);
    }
  });

  // ─── Pixel expiry (every 15 minutes) ───────────────────────────────────────
  cron.schedule('*/15 * * * *', async () => {
    if (!(await acquireLock('lock:cron:pixelExpiry', 14 * 60))) return;
    try {
      const expired = await query(
        `UPDATE pixels
         SET is_active = false
         WHERE is_active = true AND expires_at < now()
         RETURNING id, user_id, lat, lng, country_code`,
        []
      );

      for (const px of expired.rows) {
        if (!px.user_id) continue;

        const userRes = await query(
          `SELECT pgp_sym_decrypt(u.email, $2) AS email, u.country_code AS city_name, u.lang
           FROM users u
           WHERE u.id = $1 AND u.deleted_at IS NULL`,
          [px.user_id, process.env.EMAIL_ENCRYPTION_KEY]
        );

        if (userRes.rows.length > 0) {
          const { email, city_name, lang } = userRes.rows[0];
          const deepLink = `${process.env.FRONTEND_URL}/?lat=${px.lat}&lng=${px.lng}&zoom=16`;
          queueEmail('pixelExpired', () => sendPixelExpiredEmail(email, city_name, deepLink, lang));
        }
      }

      if (expired.rows.length > 0) {
        console.log(`[cron] Expired ${expired.rows.length} pixels`);
      }
    } catch (err) {
      console.error('[cron] pixelExpiry error:', err);
    }
  });
}
