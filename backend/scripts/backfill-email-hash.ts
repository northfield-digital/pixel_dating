/**
 * One-time backfill for users.email_lookup_hash.
 *
 * Reads every row that still has a NULL hash, decrypts the email blob
 * using EMAIL_ENCRYPTION_KEY, computes HMAC(EMAIL_HASH_KEY, lower(email)),
 * and writes the result. Safe to re-run.
 *
 * Run with:
 *   cd backend && npx tsx scripts/backfill-email-hash.ts
 */
import 'dotenv/config';
import { pool } from '../src/db/index.js';
import { computeEmailHash } from '../src/lib/emailHash.js';

async function main() {
  if (!process.env.EMAIL_ENCRYPTION_KEY) throw new Error('EMAIL_ENCRYPTION_KEY not set');
  if (!process.env.EMAIL_HASH_KEY) throw new Error('EMAIL_HASH_KEY not set');

  const client = await pool.connect();
  try {
    let total = 0;
    while (true) {
      const batch = await client.query<{ id: string; email: string }>(
        `SELECT id, pgp_sym_decrypt(email, $1) AS email
         FROM users
         WHERE email_lookup_hash IS NULL
         LIMIT 500`,
        [process.env.EMAIL_ENCRYPTION_KEY],
      );
      if (batch.rows.length === 0) break;

      for (const row of batch.rows) {
        const hash = computeEmailHash(row.email);
        await client.query(
          `UPDATE users SET email_lookup_hash = $1 WHERE id = $2`,
          [hash, row.id],
        );
      }
      total += batch.rows.length;
      console.log(`[backfill] processed ${total} rows`);
    }
    console.log(`[backfill] done — ${total} rows updated`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[backfill] failed:', err);
  process.exit(1);
});
