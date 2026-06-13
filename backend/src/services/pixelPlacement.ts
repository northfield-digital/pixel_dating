import type { PoolClient } from 'pg';
import { query } from '../db/index.js';
import { COUNTRIES, isSupportedCountry } from '../lib/countries.js';

/** Either the global pool helper or a transaction-bound client. */
type Querier = { query: typeof query } | PoolClient;

export const PERSON_COLOR = '#FF00B8';
export const EVENT_COLOR = '#00A3FF';

// 20 m proximity rule for all pixel types.
const MIN_DISTANCE = 20;

const COUNTRY_BOUNDS: Record<string, { minLat: number; maxLat: number; minLng: number; maxLng: number }> = {
  ES: { minLat: 27.6, maxLat: 43.8, minLng: -18.2, maxLng: 4.4 },
  CH: { minLat: 45.8, maxLat: 47.9, minLng: 5.9, maxLng: 10.5 },
  AR: { minLat: -55.1, maxLat: -21.8, minLng: -73.6, maxLng: -53.6 },
  MX: { minLat: 14.5, maxLat: 32.7, minLng: -118.4, maxLng: -86.7 },
};

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export function isPointInCountry(lat: number, lng: number, countryCode: string): boolean {
  const bounds = COUNTRY_BOUNDS[countryCode];
  if (!bounds) return false;
  return lat >= bounds.minLat && lat <= bounds.maxLat && lng >= bounds.minLng && lng <= bounds.maxLng;
}

export function getSupportedCountries(): string[] {
  return Object.keys(COUNTRY_BOUNDS);
}

export async function validatePixelLocation(
  lat: number,
  lng: number,
  _type: 'person' | 'event',
  countryCode: string,
  client: Querier = { query },
): Promise<ValidationResult> {
  if (!COUNTRY_BOUNDS[countryCode]) {
    return { valid: false, reason: 'country_unsupported' };
  }
  if (!isPointInCountry(lat, lng, countryCode)) {
    return { valid: false, reason: 'outside_country' };
  }

  // Pending pixels (is_active=false, created within last 2h) also block
  // new placements — otherwise two users could both pass validation and
  // both go to Stripe checkout for the same square metre.
  const proximityRes = await client.query(
    `SELECT EXISTS(
       SELECT 1 FROM pixels
       WHERE (is_active = true OR created_at > now() - interval '2 hours')
         AND ST_DWithin(
           ST_MakePoint(lng, lat)::geography,
           ST_MakePoint($2, $1)::geography,
           $3
         )
     ) AS too_close`,
    [lat, lng, MIN_DISTANCE],
  );

  if (proximityRes.rows[0].too_close) {
    return { valid: false, reason: 'too_close' };
  }

  return { valid: true };
}

export interface CreatePixelInput {
  userId: string;
  countryCode: string;
  type: 'person' | 'event';
  lat: number;
  lng: number;
  eventText: string | null;
  /** Long-form description; required for event pixels, ignored for person pixels. */
  eventDescription: string | null;
  /** ISO date (YYYY-MM-DD) for event pixels; ignored for person pixels. */
  eventDate: string | null;
}

/**
 * Insert a "pending" pixel row. The pixel is only visible to the owner
 * until activation by the Stripe webhook (or the dev free-bypass). We
 * use a 2-hour expiry so abandoned checkouts are auto-cleaned by the
 * pixel-expiry cron.
 */
export async function createPendingPixel(input: CreatePixelInput, client: Querier = { query }): Promise<number> {
  const color = input.type === 'person' ? PERSON_COLOR : EVENT_COLOR;
  const pixelRes = await client.query(
    `INSERT INTO pixels (user_id, country_code, type, lat, lng, color, event_text, event_description, event_date, is_active, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false, now() + interval '2 hours')
     RETURNING id`,
    [input.userId, input.countryCode, input.type, input.lat, input.lng, color, input.eventText, input.eventDescription, input.eventDate],
  );
  return pixelRes.rows[0].id;
}

/**
 * Activate a pending pixel after payment.
 *
 * - person pixels: 30-day window (kept from before).
 * - event pixels: expire at end-of-day UTC of the chosen event_date.
 *   We don't carry across timezones — the spec considers a calendar day
 *   as a single visibility window, which is good enough for "see the
 *   event throughout the day".
 */
/**
 * Flip a pending pixel to active. Returns the rowCount of the pixel
 * update so callers can detect "already activated" (idempotent) without
 * re-applying side effects.
 *
 * The `WHERE is_active = false` guard makes this safe to call twice for
 * the same pixel — duplicate webhook deliveries will see rowCount = 0
 * and skip the customer/payment side effects.
 */
export async function activatePixel(
  pixelId: number,
  stripeCustomerId: string,
  userId: string,
): Promise<{ activated: boolean }> {
  const upd = await query(
    `UPDATE pixels
     SET is_active = true,
         expires_at = CASE
           WHEN type = 'person' THEN now() + interval '30 days'
           WHEN event_date IS NOT NULL THEN (event_date::timestamptz + interval '1 day' - interval '1 second')
           ELSE now() + interval '3 days'
         END
     WHERE id = $1 AND is_active = false AND user_id = $2`,
    [pixelId, userId],
  );

  if (upd.rowCount === 0) {
    return { activated: false };
  }

  await query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [stripeCustomerId, userId]);
  await query('UPDATE stripe_payments SET status = $1 WHERE pixel_id = $2', ['completed', pixelId]);
  return { activated: true };
}

export { COUNTRIES, isSupportedCountry };
