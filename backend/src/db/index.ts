import { Pool, PoolClient } from 'pg';

const isProduction = process.env.NODE_ENV === 'production';

// Per-instance pool size. With Supabase, point DATABASE_URL at the
// transaction pooler (port 6543) and keep this small — total active
// connections = poolMax * replicas, and Supabase free/Pro caps are low
// (60/200 direct connections). 10 is a safe default for a 2–4 replica
// deployment behind the pooler.
const poolMax = parseInt(process.env.DB_POOL_SIZE || '10', 10);
const idleTimeoutMs = parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10);
const connectTimeoutMs = parseInt(process.env.DB_CONNECT_TIMEOUT_MS || '5000', 10);
const statementTimeoutMs = parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '15000', 10);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: poolMax,
  idleTimeoutMillis: idleTimeoutMs,
  connectionTimeoutMillis: connectTimeoutMs,
  statement_timeout: statementTimeoutMs,
});

pool.on('error', (err) => {
  console.error('[pg] unexpected idle client error:', err);
});

export async function query(text: string, params?: unknown[]) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
