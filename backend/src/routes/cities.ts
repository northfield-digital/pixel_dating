import { Router, Request, Response } from 'express';
import { query } from '../db/index.js';
import { COUNTRIES, DENSITY_CEILING_PER_KM2, isSupportedCountry, countryName } from '../lib/countries.js';
import type { Lang } from '../lib/i18n.js';
import { getRedis } from '../lib/redis.js';

const router = Router();

function pickLang(req: Request): Lang {
  const q = (req.query.lang as string) || '';
  if (q === 'es' || q === 'pt' || q === 'en') return q;
  return 'en';
}

// GET /api/cities?country=ES
router.get('/', async (req: Request, res: Response): Promise<void> => {
  const country = (req.query.country as string)?.toUpperCase();
  const result = country
    ? await query('SELECT id, name, country_code FROM cities WHERE country_code = $1 ORDER BY name', [country])
    : await query('SELECT id, name, country_code FROM cities ORDER BY country_code, name', []);
  res.json({ cities: result.rows });
});

// GET /api/cities/countries — list of supported countries (translated)
router.get('/countries', (req: Request, res: Response): void => {
  const lang = pickLang(req);
  const list = Object.values(COUNTRIES).map((c) => ({
    code: c.code,
    name: countryName(c.code, lang),
    area_km2: c.area_km2,
  }));
  res.json({ countries: list });
});

/**
 * GET /api/cities/country/:cc/occupancy
 *
 * Returns the country's occupancy as a percentage. With a 20 m minimum
 * distance the absolute geometric ceiling is roughly 1 pixel per
 * ~1257 m², but real-world placement clusters in inhabited areas, so
 * we use a habitable-density cap of DENSITY_CEILING_PER_KM2 pixels per
 * km² as the practical "100% full" point. The figure is purely
 * informational; nothing in the placement logic uses it.
 */
router.get('/country/:cc/occupancy', async (req: Request, res: Response): Promise<void> => {
  const cc = String(req.params.cc).toUpperCase();
  if (!isSupportedCountry(cc)) {
    res.status(404).json({ error: 'Unsupported country' });
    return;
  }
  const country = COUNTRIES[cc];

  const r = await query(
    `SELECT
       COUNT(*) FILTER (WHERE type = 'person') AS person_count,
       COUNT(*) FILTER (WHERE type = 'event')  AS event_count,
       COUNT(*) AS total_count
     FROM pixels
     WHERE is_active = true AND expires_at > now() AND country_code = $1`,
    [cc],
  );
  const row = r.rows[0] ?? { person_count: 0, event_count: 0, total_count: 0 };
  const personCount = Number(row.person_count);
  const eventCount = Number(row.event_count);
  const totalCount = Number(row.total_count);

  const ceiling = country.area_km2 * DENSITY_CEILING_PER_KM2;
  const occupancyPct = ceiling > 0 ? Math.min(100, (totalCount / ceiling) * 100) : 0;

  res.set('Cache-Control', 'public, max-age=60');
  res.json({
    country_code: cc,
    name: countryName(cc, pickLang(req)),
    area_km2: country.area_km2,
    person_count: personCount,
    event_count: eventCount,
    total_count: totalCount,
    occupancy_pct: Number(occupancyPct.toFixed(3)),
    density_ceiling_per_km2: DENSITY_CEILING_PER_KM2,
  });
});

// GET /api/cities/detect-country — country code from IP.
// Cached by IP in Redis for 24h, with a 1.5s timeout on the upstream call.
// Fails open (returns null) so the registration form is never blocked by
// an ipapi.co outage.
const DETECT_TTL_SECONDS = 24 * 60 * 60;
const DETECT_TIMEOUT_MS = 1_500;

router.get('/detect-country', async (req: Request, res: Response): Promise<void> => {
  const rawIp = req.ip ?? '';
  const isLocal = rawIp === '' || rawIp === '::1' || rawIp === '127.0.0.1';
  const cacheKey = isLocal ? 'detect:_local' : `detect:${rawIp}`;

  const redis = await getRedis();
  if (redis) {
    try {
      const cached = await redis.get(cacheKey);
      if (cached !== null) {
        res.set('Cache-Control', 'private, max-age=86400');
        res.json({ country_code: cached === '' ? null : cached });
        return;
      }
    } catch (err) {
      console.error('[detect-country] redis get failed:', err);
    }
  }

  const url = isLocal ? 'https://ipapi.co/json/' : `https://ipapi.co/${rawIp}/json/`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DETECT_TIMEOUT_MS);

  let countryCode: string | null = null;
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (response.ok) {
      const data = await response.json() as { country_code?: string };
      countryCode = data.country_code ?? null;
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      console.error('[detect-country] upstream failed:', err);
    }
  } finally {
    clearTimeout(timer);
  }

  if (redis) {
    try {
      // Cache even null results so we don't keep hammering ipapi.co for
      // IPs they don't resolve. Empty string sentinel = "looked up,
      // upstream said no".
      await redis.set(cacheKey, countryCode ?? '', { EX: DETECT_TTL_SECONDS });
    } catch (err) {
      console.error('[detect-country] redis set failed:', err);
    }
  }

  res.set('Cache-Control', 'private, max-age=3600');
  res.json({ country_code: countryCode });
});

export default router;
