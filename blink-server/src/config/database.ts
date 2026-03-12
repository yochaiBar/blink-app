import { Pool, QueryResult } from 'pg';
import dotenv from 'dotenv';
import logger from '../utils/logger';

dotenv.config();

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

export default pool;
