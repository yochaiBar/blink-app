import { Pool, PoolClient, QueryResult } from 'pg';
import logger from '../utils/logger';
import { env } from './env';

const isProduction = env.NODE_ENV === 'production';
// Railway's private network (*.railway.internal) is already TLS-encrypted at
// the transport layer, and its Postgres image rejects client-side SSL
// handshakes ("could not accept SSL connection: EOF detected"). Skip SSL
// automatically for internal hosts; keep it for external managed Postgres.
const isRailwayInternal = env.DATABASE_URL.includes('.railway.internal');

const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: parseInt(env.DB_POOL_MAX || '20', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ...(isProduction &&
    !isRailwayInternal && {
      ssl: {
        rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
        ...(env.DB_SSL_CERT && {
          ca: env.DB_SSL_CERT,
        }),
      },
    }),
});

pool.on('error', (err) => {
  logger.error('Unexpected database pool error', { error: err.message });
  process.exit(-1);
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const query = <T extends Record<string, any> = Record<string, any>>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> => pool.query<T>(text, params);

/**
 * Execute a callback within a database transaction.
 * Automatically BEGINs, COMMITs on success, and ROLLBACKs on error.
 * The client is always released back to the pool.
 *
 * Every query inside `fn` must go through `client` — `query()` would pick
 * another pooled connection outside the transaction.
 */
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

export default pool;
