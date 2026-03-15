import { Pool, PoolClient, QueryResult } from 'pg';
import dotenv from 'dotenv';
import logger from '../utils/logger';

dotenv.config();

// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const isProduction = process.env.NODE_ENV === 'production';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: parseInt(process.env.DB_POOL_MAX || '20', 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  // Railway and most cloud Postgres providers require SSL
  ...(isProduction && {
    ssl: {
      rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false',
      ...(process.env.DB_SSL_CERT && {
        ca: process.env.DB_SSL_CERT,
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
  params?: unknown[]
): Promise<QueryResult<T>> => pool.query<T>(text, params);

/**
 * Execute a callback within a database transaction.
 * Automatically BEGINs, COMMITs on success, and ROLLBACKs on error.
 * The client is always released back to the pool.
 *
 * In test environments where pool.connect is not available (mock),
 * falls back to running queries through the pool directly without
 * transaction wrapping. This keeps existing test mocks working.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  // In test/mock environments, pool.connect may not exist.
  // Fall back to a pseudo-client that delegates to pool.query.
  if (typeof pool.connect !== 'function') {
    const pseudoClient = {
      query: pool.query.bind(pool),
      release: () => {},
    } as unknown as PoolClient;
    return fn(pseudoClient);
  }

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
