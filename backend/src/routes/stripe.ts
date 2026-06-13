import { Router, Request, Response } from 'express';
import Stripe from 'stripe';
import { query } from '../db/index.js';
import { activatePixel } from '../services/pixelPlacement.js';
import { sendPixelActiveEmail } from '../emails/pixelActive.js';
import { queueEmail } from '../lib/emailQueue.js';

const router = Router();
const getStripe = () => {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not configured');
  return new Stripe(process.env.STRIPE_SECRET_KEY);
};

// POST /api/stripe/webhook
// Must be registered BEFORE express.json() middleware — needs raw body
router.post('/webhook', async (req: Request, res: Response): Promise<void> => {
  const sig = req.headers['stripe-signature'] as string;
  let event: Stripe.Event;

  try {
    event = getStripe().webhooks.constructEvent(
      req.body, // raw buffer, set up in index.ts
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    console.error('Stripe webhook signature error:', err);
    res.status(400).send('Webhook signature verification failed');
    return;
  }

  // Idempotency: Stripe will retry events on transient failures. Insert
  // event id into stripe_events with ON CONFLICT DO NOTHING — if the row
  // already exists we've already processed (or are processing) this event
  // and must short-circuit to prevent duplicate pixel activation / emails.
  try {
    const insertRes = await query(
      `INSERT INTO stripe_events (event_id, type) VALUES ($1, $2)
       ON CONFLICT (event_id) DO NOTHING
       RETURNING event_id`,
      [event.id, event.type]
    );
    if (insertRes.rowCount === 0) {
      console.log(`[stripe] duplicate event ${event.id} (${event.type}) — skipping`);
      res.json({ received: true, duplicate: true });
      return;
    }
  } catch (err) {
    console.error('[stripe] idempotency check failed:', err);
    // Fail closed — let Stripe retry rather than risk double-processing.
    res.status(500).send('idempotency store unavailable');
    return;
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;

      if (session.payment_status !== 'paid') {
        console.log('Checkout completed but payment not yet settled, skipping activation');
        break;
      }

      const { user_id, pixel_id } = session.metadata ?? {};

      if (!user_id || !pixel_id) {
        console.error('[stripe] webhook missing metadata', session.metadata);
        break;
      }

      const pixelIdNum = parseInt(pixel_id, 10);
      if (Number.isNaN(pixelIdNum)) {
        console.error('[stripe] webhook bad pixel_id metadata', pixel_id);
        break;
      }

      // Defence in depth: verify the pending pixel was created by the
      // user named in metadata and is still inactive. If either check
      // fails, refuse to activate so a malicious or replayed checkout
      // cannot promote an arbitrary pixel.
      const pixelRes = await query(
        `SELECT user_id, is_active FROM pixels WHERE id = $1`,
        [pixelIdNum],
      );
      if (pixelRes.rows.length === 0) {
        console.error('[stripe] webhook: pixel not found', { event_id: event.id, pixel_id: pixelIdNum });
        break;
      }
      if (pixelRes.rows[0].user_id !== user_id) {
        console.error('[stripe] webhook: pixel.user_id mismatch', { event_id: event.id, pixel_id: pixelIdNum, expected: user_id, actual: pixelRes.rows[0].user_id });
        break;
      }

      // Require a matching stripe_payments row (created during /place).
      // If none exists, something went very wrong on the way in and we
      // should not silently activate.
      const paymentRes = await query(
        `SELECT id FROM stripe_payments
         WHERE pixel_id = $1 AND user_id = $2 AND status = 'pending'
         LIMIT 1`,
        [pixelIdNum, user_id],
      );
      if (paymentRes.rows.length === 0) {
        console.error('[stripe] webhook: no pending stripe_payments row', { event_id: event.id, pixel_id: pixelIdNum, user_id });
        break;
      }

      const { activated } = await activatePixel(pixelIdNum, session.customer as string, user_id);
      if (!activated) {
        // Already active — duplicate webhook or out-of-order delivery.
        console.log(`[stripe] pixel ${pixelIdNum} already active, skipping side effects`);
        break;
      }

      // Also activate user account (in case they weren't active yet)
      await query('UPDATE users SET is_active = true WHERE id = $1', [user_id]);

      const userRes = await query(
        `SELECT pgp_sym_decrypt(u.email, $2) AS email, u.lang,
                u.country_code, p.lat, p.lng
         FROM users u
         JOIN pixels p ON p.id = $3
         WHERE u.id = $1`,
        [user_id, process.env.EMAIL_ENCRYPTION_KEY, pixelIdNum]
      );

      if (userRes.rows.length > 0) {
        const { email, lang, country_code, lat, lng } = userRes.rows[0];
        const mapUrl = `${process.env.FRONTEND_URL}/?lat=${lat}&lng=${lng}&zoom=17`;
        queueEmail('pixelActive', () => sendPixelActiveEmail(email, country_code, mapUrl, lang));
      }
      break;
    }

    case 'checkout.session.expired':
    case 'payment_intent.payment_failed': {
      // The user abandoned or failed payment. Mark the pending payment
      // and pixel as failed so the user can try again immediately and
      // we don't keep holding the coordinates.
      const session = event.data.object as { metadata?: Record<string, string> };
      const pixel_id = session.metadata?.pixel_id;
      if (!pixel_id) break;
      const pixelIdNum = parseInt(pixel_id, 10);
      if (Number.isNaN(pixelIdNum)) break;

      await query(
        `UPDATE stripe_payments SET status = 'failed'
         WHERE pixel_id = $1 AND status = 'pending'`,
        [pixelIdNum],
      );
      await query(
        `UPDATE pixels SET is_active = false, expires_at = now()
         WHERE id = $1 AND is_active = false`,
        [pixelIdNum],
      );
      console.log(`[stripe] pixel ${pixelIdNum} marked failed via ${event.type}`);
      break;
    }

    default:
      // Ignore all other events (no subscriptions in v3)
      break;
  }

  res.json({ received: true });
});

export default router;
