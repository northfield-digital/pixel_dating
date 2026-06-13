import { createHmac } from 'crypto';

/**
 * Deterministic, indexable hash of an email address.
 *
 * We keep the user's email encrypted at rest (BYTEA via pgcrypto) for
 * privacy, but we also need to look up by email for register dedup and
 * magic-link login. A SHA-256 HMAC keyed by EMAIL_HASH_KEY gives us a
 * stable 32-byte value that's safe to index and unique-constrain, while
 * still being expensive to brute-force without the secret.
 *
 * The email is lowercased + trimmed first so "Foo@bar.com" and
 * " foo@bar.com" hash to the same value.
 */
export function computeEmailHash(email: string): Buffer {
  const key = process.env.EMAIL_HASH_KEY;
  if (!key) throw new Error('EMAIL_HASH_KEY is not configured');
  const normalized = email.toLowerCase().trim();
  return createHmac('sha256', key).update(normalized).digest();
}
