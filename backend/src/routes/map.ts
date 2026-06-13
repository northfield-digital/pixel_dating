import { Router, Request, Response } from 'express';
import { query } from '../db/index.js';
import { optionalAuth, requireAuth } from '../middleware/auth.js';
import { countryName } from '../lib/countries.js';
import type { Lang } from '../lib/i18n.js';

const router = Router();

// Hard caps to keep responses bounded under load.
const MAX_PIXELS_PER_REQUEST = 2000;
const MAX_HEATMAP_POINTS = 5000;

interface BBox { minLat: number; maxLat: number; minLng: number; maxLng: number }

function parseBBox(req: Request): BBox | null {
  const minLat = parseFloat(String(req.query.minLat ?? ''));
  const maxLat = parseFloat(String(req.query.maxLat ?? ''));
  const minLng = parseFloat(String(req.query.minLng ?? ''));
  const maxLng = parseFloat(String(req.query.maxLng ?? ''));
  if ([minLat, maxLat, minLng, maxLng].some((n) => Number.isNaN(n))) return null;
  if (minLat < -90 || maxLat > 90 || minLng < -180 || maxLng > 180) return null;
  if (minLat > maxLat || minLng > maxLng) return null;
  return { minLat, maxLat, minLng, maxLng };
}

function pickLang(req: Request): Lang {
  const q = (req.query.lang as string) || '';
  if (q === 'es' || q === 'pt' || q === 'en') return q;
  return 'en';
}

// GET /api/map/heatmap
router.get('/heatmap', async (req: Request, res: Response): Promise<void> => {
  const bbox = parseBBox(req);
  const params: unknown[] = [];
  let where = 'p.is_active = true AND p.expires_at > now()';
  if (bbox) {
    params.push(bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng);
    where += ' AND p.lat BETWEEN $1 AND $2 AND p.lng BETWEEN $3 AND $4';
  }
  params.push(MAX_HEATMAP_POINTS);
  const limitParam = `$${params.length}`;
  const result = await query(
    `SELECT p.lat, p.lng, p.type, p.country_code
     FROM pixels p
     WHERE ${where}
     LIMIT ${limitParam}`,
    params,
  );
  res.set('Cache-Control', 'public, max-age=60');
  res.json({ pixels: result.rows });
});

/**
 * GET /api/map/pixels
 *
 * - bbox params (minLat,maxLat,minLng,maxLng) scope the query to the
 *   visible viewport.
 * - compat=1 enables compatibility filtering: person pixels are only
 *   returned when there is mutual gender interest with the logged-in
 *   user. Event pixels are always returned regardless of compat.
 */
router.get('/pixels', optionalAuth, async (req: Request, res: Response): Promise<void> => {
  const bbox = parseBBox(req);
  const compatOnly = req.query.compat === '1' || req.query.compat === 'true';
  const viewer = req.user;

  const params: unknown[] = [];
  const conditions: string[] = [
    'p.is_active = true',
    'p.expires_at > now()',
    '(u.deleted_at IS NULL OR u.id IS NULL)',
  ];

  if (bbox) {
    params.push(bbox.minLat, bbox.maxLat, bbox.minLng, bbox.maxLng);
    conditions.push(`p.lat BETWEEN $${params.length - 3} AND $${params.length - 2}`);
    conditions.push(`p.lng BETWEEN $${params.length - 1} AND $${params.length}`);
  }

  if (compatOnly && viewer) {
    // Mutual compatibility: viewer is interested in u.gender AND u.interested_in includes viewer.gender.
    // Events bypass this rule entirely.
    params.push(viewer.gender);
    const viewerGenderIdx = params.length;
    params.push(viewer.interestedIn);
    const viewerInterestsIdx = params.length;
    conditions.push(
      `(p.type = 'event' OR (u.gender = ANY($${viewerInterestsIdx}::text[]) AND $${viewerGenderIdx} = ANY(u.interested_in)))`,
    );
  }

  params.push(MAX_PIXELS_PER_REQUEST);
  const limitParam = `$${params.length}`;

  const result = await query(
    `SELECT p.id, p.lat, p.lng, p.type, p.color, p.is_dimmed, p.user_id,
            p.event_text, p.event_date,
            u.gender, COALESCE(p.country_code, u.country_code) AS country_code
     FROM pixels p
     LEFT JOIN users u ON u.id = p.user_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY p.created_at DESC
     LIMIT ${limitParam}`,
    params,
  );

  res.set('Cache-Control', compatOnly ? 'private, max-age=10' : 'public, max-age=10');
  res.json({ pixels: result.rows });
});

// GET /api/pixel/:pixel_id/status — lightweight activation status for
// the success page to poll. Lives on the map router so it inherits the
// higher 60/min preview limit (the place limiter is 10/min and would
// throttle the polling).
router.get('/:pixel_id/status', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const viewer = req.user!;
  const pixelId = parseInt(String(req.params.pixel_id), 10);
  if (Number.isNaN(pixelId)) {
    res.status(400).json({ error: 'Invalid pixel_id' });
    return;
  }
  const pixelRes = await query(
    `SELECT p.is_active, p.expires_at,
            (SELECT status FROM stripe_payments WHERE pixel_id = p.id ORDER BY created_at DESC LIMIT 1) AS payment_status
     FROM pixels p
     WHERE p.id = $1 AND p.user_id = $2`,
    [pixelId, viewer.id],
  );
  if (pixelRes.rows.length === 0) {
    res.status(404).json({ error: 'Pixel not found' });
    return;
  }
  const row = pixelRes.rows[0];
  res.json({
    is_active: row.is_active === true,
    payment_status: row.payment_status ?? null,
    expires_at: row.expires_at,
  });
});

// GET /api/pixel/:pixel_id/preview — hover popup data
router.get('/:pixel_id/preview', optionalAuth, async (req: Request, res: Response): Promise<void> => {
  const pixelId = parseInt(String(req.params.pixel_id), 10);
  if (Number.isNaN(pixelId)) {
    res.status(400).json({ error: 'Invalid pixel_id' });
    return;
  }
  const viewer = req.user ?? null;
  const lang = pickLang(req);

  const result = await query(
    `SELECT
       p.id, p.type, p.event_text, p.event_description, p.event_date, p.expires_at,
       COALESCE(p.country_code, u.country_code) AS country_code,
       u.name, u.birth_year, u.gender, u.interested_in,
       (SELECT COUNT(*)::int FROM event_participants ep WHERE ep.pixel_id = p.id) AS participants_count,
       CASE WHEN $2::uuid IS NULL THEN false
            ELSE EXISTS (SELECT 1 FROM event_participants ep WHERE ep.pixel_id = p.id AND ep.user_id = $2::uuid)
       END AS is_participant
     FROM pixels p
     LEFT JOIN users u ON u.id = p.user_id
     WHERE p.id = $1 AND p.is_active = true
       AND (u.deleted_at IS NULL OR u.id IS NULL)`,
    [pixelId, viewer?.id ?? null],
  );

  if (result.rows.length === 0) {
    res.status(404).json({ error: 'Pixel not found' });
    return;
  }
  const p = result.rows[0];
  const expiresAt = new Date(p.expires_at);
  const expiresInDays = Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000));
  const country = countryName(p.country_code, lang);

  if (p.type === 'event') {
    res.json({
      type: 'event',
      event_text: p.event_text,
      event_description: p.event_description,
      event_date: p.event_date, // ISO date
      expires_in_days: expiresInDays,
      expires_at: p.expires_at,
      country,
      country_code: p.country_code,
      participants_count: p.participants_count,
      is_participant: p.is_participant,
    });
    return;
  }

  const age = new Date().getUTCFullYear() - p.birth_year;
  const isCompatible = viewer
    ? viewer.interestedIn.includes(p.gender) && p.interested_in.includes(viewer.gender)
    : false;

  res.json({
    type: 'person',
    first_name: (p.name as string).split(' ')[0],
    age,
    country,
    country_code: p.country_code,
    expires_in_days: expiresInDays,
    is_compatible: isCompatible,
  });
});

export default router;
