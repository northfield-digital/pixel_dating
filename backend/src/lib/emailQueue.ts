/**
 * Fire-and-forget email dispatcher with bounded retry.
 *
 * Email sends are slow (Resend round-trip ~200-800 ms) and unreliable
 * (transient 5xx). Awaiting them inside a request handler couples user
 * latency and uptime to a third-party provider. Instead, we kick the
 * email off without awaiting it and retry a few times with exponential
 * backoff. Failures are logged but do not surface to the user.
 *
 * For a multi-instance deployment with stronger durability requirements,
 * swap this for a Redis-backed queue (BullMQ) — same call sites work.
 */

const MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function queueEmail(label: string, fn: () => Promise<unknown>): void {
  void (async () => {
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        await fn();
        if (attempt > 1) {
          console.log(`[email] ${label} sent on attempt ${attempt}`);
        }
        return;
      } catch (err) {
        lastErr = err;
        if (attempt < MAX_ATTEMPTS) {
          await delay(BASE_DELAY_MS * 2 ** (attempt - 1));
        }
      }
    }
    console.error(`[email] ${label} failed after ${MAX_ATTEMPTS} attempts:`, lastErr);
  })();
}
