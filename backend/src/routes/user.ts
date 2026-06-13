import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { sendAccountDeletedEmail } from '../emails/accountDeleted.js';
import { queueEmail } from '../lib/emailQueue.js';
import { SUPPORTED_LANGS, type Lang } from '../lib/i18n.js';

const router = Router();

// Keep in sync with routes/like.ts.
const DAILY_LIKE_LIMIT = 5;

function ageFromBirthYear(year: number): number {
  return new Date().getUTCFullYear() - year;
}

// GET /api/user/me
router.get('/me', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const viewer = req.user!;
  const now = new Date();

  const userRes = await query(
    `SELECT u.name, u.birth_year, u.gender, u.interested_in,
            u.likes_sent_today, u.likes_reset_at, u.likes_pending,
            u.country_code, u.lang,
            p.id AS pixel_id, p.lat, p.lng, p.type AS pixel_type, p.expires_at
     FROM users u
     LEFT JOIN pixels p ON p.user_id = u.id AND p.type = 'person' AND p.is_active = true
     WHERE u.id = $1 AND u.deleted_at IS NULL
     ORDER BY p.created_at DESC
     LIMIT 1`,
    [viewer.id],
  );

  if (userRes.rows.length === 0) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  const u = userRes.rows[0];

  let likesSentToday = u.likes_sent_today;
  let likesResetAt = u.likes_reset_at;
  if (likesResetAt && new Date(likesResetAt) <= now) {
    likesSentToday = 0;
    likesResetAt = null;
    await query('UPDATE users SET likes_sent_today = 0, likes_reset_at = NULL WHERE id = $1', [viewer.id]);
  }
  const likesRemaining = Math.max(0, DAILY_LIKE_LIMIT - likesSentToday);

  res.json({
    id: viewer.id,
    name: u.name,
    birth_year: u.birth_year,
    gender: u.gender,
    interested_in: u.interested_in,
    country_code: u.country_code,
    lang: u.lang,
    pixel: u.pixel_id != null ? {
      id: u.pixel_id,
      lat: u.lat,
      lng: u.lng,
      type: u.pixel_type,
      expires_at: u.expires_at,
    } : null,
    likes_remaining: likesRemaining,
    likes_reset_at: likesResetAt,
    likes_pending: u.likes_pending,
    daily_like_limit: DAILY_LIKE_LIMIT,
  });
});

// PUT /api/user/me — interested_in and lang are editable.
router.put('/me', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const viewer = req.user!;

  const UpdateSchema = z.object({
    interested_in: z.array(z.enum(['male', 'female', 'non-binary', 'other'])).min(1).optional(),
    lang: z.enum(['en', 'es', 'pt']).optional(),
  });
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  if (parsed.data.lang && !SUPPORTED_LANGS.includes(parsed.data.lang as Lang)) {
    res.status(400).json({ error: 'Unsupported language' });
    return;
  }

  const sets: string[] = [];
  const params: unknown[] = [viewer.id];
  if (parsed.data.interested_in) {
    params.push(parsed.data.interested_in);
    sets.push(`interested_in = $${params.length}`);
  }
  if (parsed.data.lang) {
    params.push(parsed.data.lang);
    sets.push(`lang = $${params.length}`);
  }
  if (sets.length === 0) {
    res.json({ message: 'Nothing to update' });
    return;
  }
  await query(`UPDATE users SET ${sets.join(', ')} WHERE id = $1`, params);
  res.json({ message: 'Preferences updated' });
});

// DELETE /api/user/me — GDPR erasure
router.delete('/me', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const viewer = req.user!;

  const result = await withTransaction(async (client) => {
    const userRes = await client.query(
      `SELECT pgp_sym_decrypt(u.email, $2) AS email, u.lang
       FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [viewer.id, process.env.EMAIL_ENCRYPTION_KEY],
    );
    if (userRes.rows.length === 0) return null;
    const userEmail = userRes.rows[0].email as string;
    const userLang = userRes.rows[0].lang as Lang;

    await client.query(
      `UPDATE pixels SET is_active = false WHERE user_id = $1 AND is_active = true`,
      [viewer.id],
    );

    const pendingClicked = await client.query(
      `SELECT clicked_id FROM connections WHERE clicker_id = $1 AND status = 'pending'`,
      [viewer.id],
    );
    for (const c of pendingClicked.rows) {
      await client.query(
        'UPDATE users SET likes_pending = GREATEST(0, likes_pending - 1) WHERE id = $1',
        [c.clicked_id],
      );
    }

    await client.query(
      `UPDATE connections SET status = 'expired'
       WHERE (clicker_id = $1 OR clicked_id = $1) AND status = 'pending'`,
      [viewer.id],
    );

    // GDPR Art. 17: erase identifying data; keep the row for FK integrity.
    // email_lookup_hash is set NULL so the address can be re-registered.
    await client.query(
      `UPDATE users SET
         deleted_at = now(),
         is_active = false,
         email_verified = false,
         verify_token = NULL,
         stripe_customer_id = NULL,
         name = 'Deleted user',
         email = pgp_sym_encrypt('deleted+' || id::text || '@pixeldating.invalid', $2),
         email_lookup_hash = NULL
       WHERE id = $1`,
      [viewer.id, process.env.EMAIL_ENCRYPTION_KEY],
    );

    return { email: userEmail, lang: userLang };
  });

  if (!result) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  queueEmail('accountDeleted', () => sendAccountDeletedEmail(result.email, result.lang));

  res.clearCookie('token');
  res.json({ message: 'Account deleted' });
});

// GET /api/user/my-pixel — back-compat: returns active person pixel only.
router.get('/my-pixel', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const viewer = req.user!;
  const result = await query(
    `SELECT id, lat, lng, type, expires_at, is_active
     FROM pixels
     WHERE user_id = $1 AND type = 'person' AND is_active = true
     ORDER BY created_at DESC
     LIMIT 1`,
    [viewer.id],
  );
  res.json(result.rows[0] ?? null);
});

// GET /api/user/connections
router.get('/connections', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const viewer = req.user!;

  const [pendingRes, matchedRes, sentRes] = await Promise.all([
    // Incoming pending: viewer is clicked_id, surface clicker's first name + age.
    query(
      `SELECT c.id, c.created_at, c.expires_at,
              u.name AS from_name, u.birth_year AS from_birth_year
       FROM connections c
       JOIN users u ON u.id = c.clicker_id
       WHERE c.clicked_id = $1 AND c.status = 'pending'
       ORDER BY c.created_at DESC`,
      [viewer.id],
    ),
    query(
      `SELECT c.id, c.matched_at,
              CASE WHEN c.clicker_id = $1 THEN u2.name ELSE u1.name END AS match_name,
              CASE WHEN c.clicker_id = $1 THEN u2.birth_year ELSE u1.birth_year END AS match_birth_year,
              CASE WHEN c.clicker_id = $1 THEN pgp_sym_decrypt(u2.email, $2) ELSE pgp_sym_decrypt(u1.email, $2) END AS match_email
       FROM connections c
       JOIN users u1 ON u1.id = c.clicker_id
       JOIN users u2 ON u2.id = c.clicked_id
       WHERE (c.clicker_id = $1 OR c.clicked_id = $1) AND c.status = 'accepted'
       ORDER BY c.matched_at DESC`,
      [viewer.id, process.env.EMAIL_ENCRYPTION_KEY],
    ),
    // Sent: viewer is clicker_id. Surface target name+age.
    query(
      `SELECT c.id, c.status, c.created_at, c.expires_at,
              u.name AS to_name, u.birth_year AS to_birth_year
       FROM connections c
       JOIN users u ON u.id = c.clicked_id
       WHERE c.clicker_id = $1 AND c.status != 'accepted'
       ORDER BY c.created_at DESC`,
      [viewer.id],
    ),
  ]);

  const decoratePending = (r: { id: string; created_at: string; expires_at: string; from_name: string; from_birth_year: number }) => ({
    id: r.id,
    created_at: r.created_at,
    expires_at: r.expires_at,
    from_name: r.from_name?.split(' ')[0] ?? r.from_name,
    from_age: ageFromBirthYear(r.from_birth_year),
  });
  const decorateMatched = (r: { id: string; matched_at: string; match_name: string; match_birth_year: number; match_email: string }) => ({
    id: r.id,
    matched_at: r.matched_at,
    match_name: r.match_name,
    match_age: ageFromBirthYear(r.match_birth_year),
    match_email: r.match_email,
  });
  const decorateSent = (r: { id: string; status: string; created_at: string; expires_at: string; to_name: string; to_birth_year: number }) => ({
    id: r.id,
    status: r.status,
    created_at: r.created_at,
    expires_at: r.expires_at,
    to_name: r.to_name?.split(' ')[0] ?? r.to_name,
    to_age: ageFromBirthYear(r.to_birth_year),
  });

  res.json({
    pending: pendingRes.rows.map(decoratePending),
    matched: matchedRes.rows.map(decorateMatched),
    sent: sentRes.rows.map(decorateSent),
  });
});

// GET /api/user/export — GDPR data export (Art. 15/20)
router.get('/export', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const viewer = req.user!;

  const [userRes, pixelsRes, connectionsRes, paymentsRes] = await Promise.all([
    query(
      `SELECT pgp_sym_decrypt(u.email, $2) AS email, u.name, u.birth_year, u.gender,
              u.interested_in, u.created_at, u.country_code, u.lang
       FROM users u
       WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [viewer.id, process.env.EMAIL_ENCRYPTION_KEY],
    ),
    query(
      `SELECT id, type, lat, lng, color, event_text, event_date, is_active, expires_at, created_at
       FROM pixels WHERE user_id = $1 ORDER BY created_at DESC`,
      [viewer.id],
    ),
    query(
      `SELECT c.id, c.status, c.created_at, c.expires_at, c.matched_at,
              CASE WHEN c.clicker_id = $1 THEN 'sent' ELSE 'received' END AS direction
       FROM connections c
       WHERE c.clicker_id = $1 OR c.clicked_id = $1
       ORDER BY c.created_at DESC`,
      [viewer.id],
    ),
    query(
      `SELECT type, amount_cents, currency, duration_days, status, created_at
       FROM stripe_payments WHERE user_id = $1 ORDER BY created_at DESC`,
      [viewer.id],
    ),
  ]);

  if (userRes.rows.length === 0) {
    res.status(404).json({ error: 'User not found' });
    return;
  }

  res.json({
    exported_at: new Date().toISOString(),
    profile: userRes.rows[0],
    pixels: pixelsRes.rows,
    connections: connectionsRes.rows,
    payments: paymentsRes.rows,
  });
});

export default router;
