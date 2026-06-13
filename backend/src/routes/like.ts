import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { sendIncomingLikeEmail } from '../emails/incomingLike.js';
import { sendMatchEmail } from '../emails/match.js';
import { queueEmail } from '../lib/emailQueue.js';

const router = Router();

// 5 free likes per day (spec v2 §3). Keep in sync with user.ts.
const DAILY_LIKE_LIMIT = 5;
const PENDING_INBOX_LIMIT = 10;

// POST /api/like/:pixel_id
router.post('/:pixel_id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const viewer = req.user!;
  const pixelId = parseInt(String(req.params.pixel_id), 10);

  if (isNaN(pixelId)) {
    res.status(400).json({ error: 'Invalid pixel_id' });
    return;
  }

  const result = await withTransaction(async (client) => {
    // Lock clicker row to prevent race condition on like counter
    const clickerRes = await client.query(
      `SELECT id, likes_sent_today, likes_reset_at
       FROM users WHERE id = $1 AND deleted_at IS NULL
       FOR UPDATE`,
      [viewer.id]
    );
    if (clickerRes.rows.length === 0) {
      return { status: 404, body: { error: 'User not found' } } as const;
    }
    const clicker = clickerRes.rows[0];

    // Get target pixel's owner
    const targetRes = await client.query(
      `SELECT u.id AS user_id, u.likes_pending, u.interested_in, u.gender, u.is_active,
              pgp_sym_decrypt(u.email, $2) AS email,
              u.name, u.country_code, u.lang, p.type AS pixel_type
       FROM pixels p
       JOIN users u ON u.id = p.user_id
       WHERE p.id = $1 AND p.is_active = true
         AND u.deleted_at IS NULL AND u.is_active = true`,
      [pixelId, process.env.EMAIL_ENCRYPTION_KEY]
    );
    if (targetRes.rows.length === 0) {
      return { status: 404, body: { error: 'Pixel not found' } } as const;
    }
    const target = targetRes.rows[0];

    // Likes are for person pixels only. Event interactions go through
    // /api/event/:pixel_id/participate and never consume a like.
    if (target.pixel_type === 'event') {
      return { status: 400, body: { error: 'cannot_like_event' } } as const;
    }

    if (target.user_id === viewer.id) {
      return { status: 400, body: { error: 'Cannot like your own pixel' } } as const;
    }

    // Check and reset rolling 24h window
    const now = new Date();
    let likesSentToday = clicker.likes_sent_today;

    if (clicker.likes_reset_at && new Date(clicker.likes_reset_at) <= now) {
      await client.query(
        'UPDATE users SET likes_sent_today = 0, likes_reset_at = NULL WHERE id = $1',
        [viewer.id]
      );
      likesSentToday = 0;
    }

    if (likesSentToday >= DAILY_LIKE_LIMIT) {
      return { status: 429, body: { error: 'Daily like limit reached', likes_reset_at: clicker.likes_reset_at } } as const;
    }

    if (target.likes_pending >= PENDING_INBOX_LIMIT) {
      return { status: 409, body: { error: "This person's inbox is full" } } as const;
    }

    const existingRes = await client.query(
      `SELECT id FROM connections
       WHERE clicker_id = $1 AND clicked_id = $2 AND status = 'pending'`,
      [viewer.id, target.user_id]
    );
    if (existingRes.rows.length > 0) {
      return { status: 409, body: { error: 'You already have a pending like with this person' } } as const;
    }

    // Create connection
    await client.query(
      `INSERT INTO connections (clicker_id, clicked_id) VALUES ($1, $2)`,
      [viewer.id, target.user_id]
    );

    const newLikesCount = likesSentToday + 1;
    let likesResetAt = clicker.likes_reset_at;

    if (newLikesCount === 1) {
      const resetAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      likesResetAt = resetAt;
      await client.query(
        'UPDATE users SET likes_sent_today = $2, likes_reset_at = $3 WHERE id = $1',
        [viewer.id, newLikesCount, resetAt]
      );
    } else {
      await client.query(
        'UPDATE users SET likes_sent_today = $2 WHERE id = $1',
        [viewer.id, newLikesCount]
      );
    }

    if (newLikesCount >= DAILY_LIKE_LIMIT) {
      await client.query(
        `UPDATE pixels SET is_dimmed = true
         WHERE user_id = $1 AND type = 'person' AND is_active = true`,
        [viewer.id]
      );
    }

    await client.query(
      'UPDATE users SET likes_pending = likes_pending + 1 WHERE id = $1',
      [target.user_id]
    );

    const likesRemaining = Math.max(0, DAILY_LIKE_LIMIT - newLikesCount);

    return {
      status: 200,
      body: { likes_remaining: likesRemaining, likes_reset_at: likesResetAt },
      notify: { email: target.email, cityName: target.country_code, lang: target.lang as 'en' | 'es' | 'pt' },
    } as const;
  });

  if (result.status !== 200) {
    res.status(result.status).json(result.body);
    return;
  }

  // Send email outside the transaction, fire-and-forget with retry so
  // Resend latency / outages don't propagate to the user.
  if ('notify' in result && result.notify) {
    const inboxUrl = `${process.env.FRONTEND_URL}/inbox`;
    queueEmail('incomingLike', () => sendIncomingLikeEmail(result.notify!.email, result.notify!.cityName, inboxUrl, result.notify!.lang));
  }

  res.json(result.body);
});

// POST /api/connection/:connection_id/respond
router.post('/:connection_id/respond', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const viewer = req.user!;
  const connectionId = req.params.connection_id;

  const RespondSchema = z.object({ accept: z.boolean() });
  const parsed = RespondSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Body must be { accept: boolean }' });
    return;
  }
  const { accept } = parsed.data;

  const result = await withTransaction(async (client) => {
    const connRes = await client.query(
      `SELECT c.*,
              pgp_sym_decrypt(u1.email, $3) AS clicker_email, u1.name AS clicker_name, u1.lang AS clicker_lang,
              pgp_sym_decrypt(u2.email, $3) AS clicked_email, u2.name AS clicked_name, u2.lang AS clicked_lang,
              u2.country_code AS city_name
       FROM connections c
       JOIN users u1 ON u1.id = c.clicker_id
       JOIN users u2 ON u2.id = c.clicked_id
       WHERE c.id = $1 AND c.clicked_id = $2 AND c.status = 'pending' AND c.expires_at > now()
       FOR UPDATE OF c`,
      [connectionId, viewer.id, process.env.EMAIL_ENCRYPTION_KEY]
    );

    if (connRes.rows.length === 0) {
      return { status: 404, body: { error: 'Connection not found or already resolved' } } as const;
    }

    const conn = connRes.rows[0];

    if (!accept) {
      await client.query(
        `UPDATE connections SET status = 'rejected', clicked_accepted = false WHERE id = $1`,
        [connectionId]
      );
      await client.query(
        'UPDATE users SET likes_pending = GREATEST(0, likes_pending - 1) WHERE id = $1',
        [viewer.id]
      );
      return { status: 200, body: { status: 'rejected' } } as const;
    }

    await client.query(
      `UPDATE connections SET status = 'accepted', clicker_accepted = true, clicked_accepted = true, matched_at = now() WHERE id = $1`,
      [connectionId]
    );
    await client.query(
      'UPDATE users SET likes_pending = GREATEST(0, likes_pending - 1) WHERE id = $1',
      [viewer.id]
    );

    return {
      status: 200,
      body: { status: 'matched' },
      notify: {
        clickerEmail: conn.clicker_email,
        clickedEmail: conn.clicked_email,
        clickerName: conn.clicker_name,
        clickedName: conn.clicked_name,
        clickerLang: conn.clicker_lang as 'en' | 'es' | 'pt',
        clickedLang: conn.clicked_lang as 'en' | 'es' | 'pt',
        cityName: conn.city_name,
      },
    } as const;
  });

  if (result.status !== 200) {
    res.status(result.status).json(result.body);
    return;
  }

  // Send match emails outside the transaction, fire-and-forget.
  if ('notify' in result && result.notify) {
    const n = result.notify;
    queueEmail('match->clicker', () => sendMatchEmail(n.clickerEmail, n.clickedName, n.clickedEmail, n.cityName, n.clickerLang));
    queueEmail('match->clicked', () => sendMatchEmail(n.clickedEmail, n.clickerName, n.clickerEmail, n.cityName, n.clickedLang));
  }

  res.json(result.body);
});

export default router;
