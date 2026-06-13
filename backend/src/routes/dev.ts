/**
 * Dev-only routes — never loaded in production (NODE_ENV=production).
 * Bypass Stripe & email verification so you can test the full UI locally.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { query } from '../db/index.js';
import { issueToken } from '../middleware/auth.js';
import { computeEmailHash } from '../lib/emailHash.js';

const router = Router();

// Defence in depth: even if these routes get mounted in production by
// mistake (e.g. NODE_ENV unset), every handler short-circuits.
router.use((req: Request, res: Response, next: NextFunction): void => {
  if (process.env.NODE_ENV === 'production') {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  // Optional IP allowlist for non-prod environments.
  const allowList = (process.env.DEV_ROUTES_ALLOW_IPS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowList.length > 0 && !allowList.includes(req.ip ?? '')) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  next();
});

// Approximate bounding boxes per country for random bot pixel placement
// [minLat, maxLat, minLng, maxLng]
const COUNTRY_BOUNDS: Record<string, [number, number, number, number]> = {
  ES: [36.0, 43.8, -9.3, 3.3],
  CH: [45.8, 47.8, 5.9, 10.5],
  AR: [-55.0, -22.0, -73.0, -53.0],
  MX: [14.5, 32.7, -117.1, -86.7],
};

function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

// ─── POST /api/dev/activate ────────────────────────────────────────────────────
// Verifies email + activates account + issues JWT cookie.
// Body: { email }   (plain text, not encrypted — dev only)
router.post('/activate', async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body as { email?: string };
  if (!email) {
    res.status(400).json({ error: 'email required' });
    return;
  }

  const userRes = await query(
    `SELECT u.id, u.gender, u.city_id, u.is_active,
            u.interested_in, c.name AS city_name, c.country_code
     FROM users u
     JOIN cities c ON c.id = u.city_id
     WHERE u.email_lookup_hash = $1
       AND u.deleted_at IS NULL`,
    [computeEmailHash(email)]
  );

  if (userRes.rows.length === 0) {
    res.status(404).json({ error: 'No user found with that email. Did you register first?' });
    return;
  }

  const u = userRes.rows[0];

  if (!u.is_active) {
    await query(
      'UPDATE users SET email_verified = true, is_active = true, verify_token = NULL WHERE id = $1',
      [u.id]
    );
  }

  issueToken(res, {
    id: u.id,
    gender: u.gender,
    interestedIn: u.interested_in,
  });

  res.json({
    message: u.is_active ? 'Already active — JWT refreshed' : `Activated! Ready to place a pixel in ${u.city_name}`,
    user_id: u.id,
    city: u.city_name,
  });
});

// ─── POST /api/dev/seed-bots ───────────────────────────────────────────────────
// Creates fake users with person pixels across cities so the map looks populated.
// Query param: ?count=30  (default 40)
router.post('/seed-bots', async (req: Request, res: Response): Promise<void> => {
  const count = Math.min(parseInt(String(req.query.count ?? '40'), 10), 200);

  const firstNames = [
    'Sofía','Alejandro','Valentina','Diego','Camila','Mateo','Lucía','Santiago',
    'Isabella','Sebastián','Emma','Nicolás','Martina','Andrés','Valeria','Gabriel',
    'Daniela','Julián','Paula','Carlos','María','Roberto','Laura','Javier',
    'Ana','Miguel','Sara','Pablo','Elena','Jorge','Carmen','Alberto','Rosa','Fernando',
    'Nora','Rafael','Julia','Hugo','Clara','Marcos','Lena','Ivan','Mia','Leo',
    'Zoe','Tom','Ava','Max','Lily','Ben',
  ];

  const citiesRes = await query(
    'SELECT id, name, country_code, lat, lng, soft_capacity FROM cities ORDER BY soft_capacity DESC'
  );
  const cities = citiesRes.rows as Array<{
    id: number; name: string; country_code: string; lat: number; lng: number; soft_capacity: number;
  }>;

  const genders = ['male', 'male', 'female', 'female', 'non-binary', 'other'];
  const interestOptions: string[][] = [
    ['female'], ['male'], ['female', 'non-binary'], ['male', 'non-binary'],
    ['male', 'female'], ['male', 'female', 'non-binary'],
  ];

  let created = 0;
  const errors: string[] = [];

  for (let i = 0; i < count; i++) {
    const city = cities[i % cities.length];
    if (!city) continue;

    const name = firstNames[i % firstNames.length] + (i >= firstNames.length ? ` ${Math.floor(i / firstNames.length) + 1}` : '');
    const email = `bot_${i}_${Date.now()}@dev.pixeldating.test`;
    const gender = genders[i % genders.length] as string;
    const interestedIn = interestOptions[i % interestOptions.length] as string[];
    const birthYear = 1988 + (i % 20);

    // Random lat/lng near the city center (within ~0.05° ≈ 5km)
    const bounds = COUNTRY_BOUNDS[city.country_code];
    const lat = bounds
      ? randomInRange(Math.max(bounds[0], city.lat - 0.05), Math.min(bounds[1], city.lat + 0.05))
      : city.lat + (Math.random() - 0.5) * 0.1;
    const lng = bounds
      ? randomInRange(Math.max(bounds[2], city.lng - 0.05), Math.min(bounds[3], city.lng + 0.05))
      : city.lng + (Math.random() - 0.5) * 0.1;

    try {
      const userRes = await query(
        `INSERT INTO users
           (email, email_lookup_hash, name, birth_year, gender, interested_in, city_id, country_code,
            email_verified, is_active)
         VALUES
           (pgp_sym_encrypt($1, $2), $3, $4, $5, $6, $7, $8, $9, true, true)
         RETURNING id`,
        [email, process.env.EMAIL_ENCRYPTION_KEY, computeEmailHash(email), name, birthYear, gender,
         interestedIn, city.id, city.country_code]
      );

      const userId = userRes.rows[0].id as string;

      // Insert active person pixel directly (bypass Stripe for dev)
      await query(
        `INSERT INTO pixels (user_id, city_id, type, lat, lng, color, is_active, expires_at)
         VALUES ($1, $2, 'person', $3, $4, '#FF00B8', true, now() + interval '30 days')`,
        [userId, city.id, lat, lng]
      );

      created++;
    } catch (err) {
      errors.push(`bot_${i}: ${(err as Error).message}`);
    }
  }

  res.json({
    message: `Created ${created} bots`,
    requested: count,
    errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
  });
});

// ─── DELETE /api/dev/wipe-bots ─────────────────────────────────────────────────
// Removes all bot users (email ends with @dev.pixeldating.test)
router.delete('/wipe-bots', async (_req: Request, res: Response): Promise<void> => {
  const botsRes = await query(
    `SELECT u.id FROM users u
     WHERE pgp_sym_decrypt(u.email, $1) LIKE '%@dev.pixeldating.test'
       AND u.deleted_at IS NULL`,
    [process.env.EMAIL_ENCRYPTION_KEY]
  );

  let removed = 0;
  for (const bot of botsRes.rows) {
    await query(`UPDATE pixels SET is_active = false WHERE user_id = $1`, [bot.id]);
    await query('UPDATE users SET deleted_at = now() WHERE id = $1', [bot.id]);
    removed++;
  }

  res.json({ message: `Removed ${removed} bots` });
});

export default router;
