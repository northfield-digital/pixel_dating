/**
 * Optional Sentry integration. Activated only when SENTRY_DSN is set.
 *
 * We init synchronously at module load (Sentry's SDK is happy to be a
 * no-op when init isn't called) so handlers in index.ts can reference
 * the SDK regardless of whether it's configured. In dev, leave SENTRY_DSN
 * unset and Sentry is silent.
 */
import * as Sentry from '@sentry/node';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    // Conservative sample rate; bump after baseline traffic is known.
    tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    // Anything we don't want to leak: emails, hashes, secrets.
    sendDefaultPii: false,
    beforeSend(event) {
      // Strip cookies and authorization headers defensively.
      if (event.request) {
        delete event.request.cookies;
        if (event.request.headers) {
          delete event.request.headers['cookie'];
          delete event.request.headers['authorization'];
        }
      }
      return event;
    },
  });
  console.log('[sentry] initialised');
}

export const sentryEnabled = !!dsn;
export { Sentry };
