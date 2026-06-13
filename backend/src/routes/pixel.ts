import { Router, Request, Response } from 'express';
import { z } from 'zod';
import Stripe from 'stripe';
import { query, withTransaction } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { validatePixelLocation, createPendingPixel, activatePixel } from '../services/pixelPlacement.js';

const router = Router();

const PERSON_PRICE_CENTS = 150;
const EVENT_PRICE_CENTS = 300;
const EVENT_MAX_LEAD_DAYS = 30;
const EVENT_WEEKLY_LIMIT = 5;

const getStripe = () => {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not configured');
  return new Stripe(process.env.STRIPE_SECRET_KEY);
};

const ValidateSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  type: z.enum(['person', 'event']),
  country_code: z.string().length(2),
});

// ISO date YYYY-MM-DD, today through today + 30 days inclusive.
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const PlaceSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  type: z.enum(['person', 'event']),
  country_code: z.string().length(2),
  event_text: z.string().min(1).max(100).optional(),
  event_description: z.string().min(1).max(500).optional(),
  event_date: isoDate.optional(),
});

function isWithinEventLeadWindow(dateStr: string): boolean {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00Z');
  if (Number.isNaN(target.getTime())) return false;
  const maxDate = new Date(today);
  maxDate.setUTCDate(maxDate.getUTCDate() + EVENT_MAX_LEAD_DAYS);
  return target.getTime() >= today.getTime() && target.getTime() <= maxDate.getTime();
}

// POST /api/pixel/validate — public, rate-limited
router.post('/validate', async (req: Request, res: Response): Promise<void> => {
  const parsed = ValidateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { lat, lng, type, country_code } = parsed.data;
  const result = await validatePixelLocation(lat, lng, type, country_code);
  res.json(result);
});

// POST /api/pixel/place — auth required
router.post('/place', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const user = req.user!;

  const parsed = PlaceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { lat, lng, type, country_code, event_text, event_description, event_date } = parsed.data;

  // Cheap validation that doesn't need the DB.
  if (type === 'event') {
    if (!event_text || event_text.trim().length === 0) {
      res.status(400).json({ error: 'event_text required for event pixels' });
      return;
    }
    if (!event_description || event_description.trim().length === 0) {
      res.status(400).json({ error: 'event_description required for event pixels' });
      return;
    }
    if (!event_date) {
      res.status(400).json({ error: 'event_date required for event pixels' });
      return;
    }
    if (!isWithinEventLeadWindow(event_date)) {
      res.status(400).json({ error: `event_date must be within the next ${EVENT_MAX_LEAD_DAYS} days` });
      return;
    }
  }

  const amountCents = type === 'person' ? PERSON_PRICE_CENTS : EVENT_PRICE_CENTS;
  const stripeType = type === 'person' ? 'person_pixel' : 'event_pixel';
  const duration = type === 'person' ? 30 : 1;

  // ─── Phase 1: atomically reserve the pixel + payment row ─────────────
  // We take a country-level advisory lock so concurrent placements in
  // the same country serialise (low contention at our scale, and stops
  // two users from claiming the same coordinates). We also FOR UPDATE
  // the user row to serialise that user's own concurrent attempts
  // (double-click on "Pay"). Both locks release on COMMIT/ROLLBACK.
  let reservation: { pixelId: number; paymentId: string } | { errorStatus: number; error: string };
  try {
    reservation = await withTransaction(async (client) => {
      // Country-wide lock for placement serialisation.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`px_country:${country_code}`]);

      // Per-user lock so a single user's parallel requests serialise.
      const userLock = await client.query(
        `SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [user.id],
      );
      if (userLock.rowCount === 0) {
        return { errorStatus: 404, error: 'User not found' } as const;
      }

      if (type === 'event') {
        const weeklyRes = await client.query(
          `SELECT COUNT(*)::int AS n FROM pixels
           WHERE user_id = $1 AND type = 'event'
             AND (is_active = true OR created_at > now() - interval '2 hours')
             AND created_at > now() - interval '7 days'`,
          [user.id],
        );
        if (weeklyRes.rows[0].n >= EVENT_WEEKLY_LIMIT) {
          return { errorStatus: 429, error: 'event_weekly_limit' } as const;
        }
      }

      if (type === 'person') {
        const activeRes = await client.query(
          `SELECT id FROM pixels
           WHERE user_id = $1 AND type = 'person'
             AND (is_active = true OR created_at > now() - interval '2 hours')
           LIMIT 1`,
          [user.id],
        );
        if (activeRes.rowCount && activeRes.rowCount > 0) {
          return { errorStatus: 409, error: 'You already have an active person pixel. Cancel it first.' } as const;
        }
      }

      const validation = await validatePixelLocation(lat, lng, type, country_code, client);
      if (!validation.valid) {
        return { errorStatus: 400, error: validation.reason ?? 'invalid_location' } as const;
      }

      const pixelId = await createPendingPixel({
        userId: user.id,
        countryCode: country_code,
        type,
        lat,
        lng,
        eventText: event_text ?? null,
        eventDescription: type === 'event' ? (event_description ?? null) : null,
        eventDate: type === 'event' ? (event_date ?? null) : null,
      }, client);

      // Insert payment row BEFORE creating the Stripe session — if the
      // Stripe API call fails afterwards we still have an audit record,
      // and the webhook can never race ahead of us. stripe_session_id is
      // filled in once we receive the session id from Stripe.
      const paymentRes = await client.query(
        `INSERT INTO stripe_payments (user_id, pixel_id, type, amount_cents, duration_days, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')
         RETURNING id`,
        [user.id, pixelId, stripeType, amountCents, duration],
      );

      return { pixelId, paymentId: paymentRes.rows[0].id as string } as const;
    });
  } catch (err) {
    // Catch unique-violation from the partial index for person pixels.
    const code = (err as { code?: string }).code;
    if (code === '23505') {
      res.status(409).json({ error: 'You already have an active person pixel. Cancel it first.' });
      return;
    }
    throw err;
  }

  if ('errorStatus' in reservation) {
    res.status(reservation.errorStatus).json({ error: reservation.error });
    return;
  }

  const { pixelId, paymentId } = reservation;

  // Dev bypass: skip Stripe when no key is configured
  if (process.env.NODE_ENV !== 'production' && !process.env.STRIPE_SECRET_KEY) {
    await activatePixel(pixelId, 'dev_no_stripe', user.id);
    await query('UPDATE users SET is_active = true WHERE id = $1', [user.id]);
    console.log(`[DEV] Pixel ${pixelId} activated without Stripe (free bypass)`);
    res.json({ stripe_checkout_url: `${process.env.FRONTEND_URL}/place/success?pixel_id=${pixelId}` });
    return;
  }

  // ─── Phase 2: create Stripe session, then attach its id ──────────────
  // The pixel + payment rows are already in the DB; we attach the
  // session id here. If Stripe rejects, we mark the payment failed and
  // expire the pixel so the user can try again immediately.
  const productName = type === 'person'
    ? 'Pixel Dating — Person pixel (30 days)'
    : `Pixel Dating — Event pixel (${event_date})`;

  let session: Stripe.Checkout.Session;
  try {
    session = await getStripe().checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: { name: productName },
            unit_amount: amountCents,
          },
          quantity: 1,
        },
      ],
      success_url: `${process.env.FRONTEND_URL}/place/success?pixel_id=${pixelId}`,
      cancel_url: `${process.env.FRONTEND_URL}/place`,
      metadata: {
        user_id: user.id,
        pixel_id: pixelId.toString(),
        payment_id: paymentId,
        type: stripeType,
      },
    });
  } catch (err) {
    console.error('[stripe] checkout.sessions.create failed:', err);
    await query(
      `UPDATE stripe_payments SET status = 'failed' WHERE id = $1`,
      [paymentId],
    );
    await query(
      `UPDATE pixels SET is_active = false, expires_at = now() WHERE id = $1`,
      [pixelId],
    );
    res.status(502).json({ error: 'payment_provider_unavailable' });
    return;
  }

  await query(
    `UPDATE stripe_payments SET stripe_session_id = $1 WHERE id = $2`,
    [session.id, paymentId],
  );

  res.json({ stripe_checkout_url: session.url });
});

// GET /api/pixel/mine — every active pixel owned by the user
router.get('/mine', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const user = req.user!;
  const result = await query(
    `SELECT id, type, lat, lng, color, event_text, event_date, expires_at
     FROM pixels
     WHERE user_id = $1 AND is_active = true AND expires_at > now()
     ORDER BY type, expires_at`,
    [user.id],
  );
  res.json({ pixels: result.rows });
});

// DELETE /api/pixel/:id — cancel one of the user's active pixels.
router.delete('/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  const user = req.user!;
  const id = parseInt(String(req.params.id), 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: 'Invalid pixel id' });
    return;
  }

  const upd = await query(
    `UPDATE pixels SET is_active = false, expires_at = now()
     WHERE id = $1 AND user_id = $2 AND is_active = true
     RETURNING id`,
    [id, user.id],
  );

  if (upd.rowCount === 0) {
    res.status(404).json({ error: 'Pixel not found or already inactive' });
    return;
  }
  res.json({ ok: true, id });
});

export default router;
