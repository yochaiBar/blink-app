import { withTransaction } from './database';
import fs from 'fs';
import path from 'path';
import * as Sentry from '@sentry/node';
import type { PoolClient } from 'pg';
import logger from '../utils/logger';
import { env } from './env';

// Every runner (each booting replica, or a manual `npm run migrate`) takes
// this transaction-scoped advisory lock before touching schema_migrations,
// so two processes can never apply the same file at once.
const MIGRATION_LOCK_SQL = `SELECT pg_advisory_xact_lock(hashtext('blink:schema_migrations'))`;

// Create tracking table
async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

async function isApplied(client: PoolClient, file: string): Promise<boolean> {
  const result = await client.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [file]);
  return result.rows.length > 0;
}

// A database that recorded a migration file we no longer ship was built by
// a different migration history (e.g. the pre-baseline 001–016 files).
// Running on top of it would leave a half-matching schema, so refuse.
async function assertKnownHistory(client: PoolClient, files: string[]): Promise<void> {
  const result = await client.query<{ filename: string }>('SELECT filename FROM schema_migrations ORDER BY id');
  const unknown = result.rows.map((r) => r.filename).filter((f) => !files.includes(f));
  if (unknown.length > 0) {
    throw new Error(
      `schema_migrations lists migration(s) not in migrations/: ${unknown.join(', ')}. ` +
        'This database predates the current migration history (001_baseline.sql); point DATABASE_URL at a fresh database.',
    );
  }
}

// Run all pending migrations in order. Each file runs on a single
// connection inside its own transaction (withTransaction), so a failing
// migration rolls back completely and is not recorded.
export async function runMigrations(): Promise<void> {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort(); // Alphabetical = chronological with NNN_ prefix

  await withTransaction(async (client) => {
    await client.query(MIGRATION_LOCK_SQL);
    await ensureMigrationsTable(client);
    await assertKnownHistory(client, files);
  });

  let ranCount = 0;

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

    try {
      const ran = await withTransaction(async (client) => {
        await client.query(MIGRATION_LOCK_SQL);
        // Re-check under the lock: another runner may have applied it
        // while we were waiting.
        if (await isApplied(client, file)) return false;

        logger.info(`Running migration: ${file}`);
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        return true;
      });

      if (ran) {
        logger.info(`Migration complete: ${file}`);
        ranCount++;
      } else {
        logger.info(`Migration already applied: ${file}`);
      }
    } catch (err) {
      logger.error(`Migration failed: ${file}`, { error: (err as Error).message });
      throw err;
    }
  }

  if (ranCount === 0) {
    logger.info('All migrations already applied. Nothing to do.');
  } else {
    logger.info(`Successfully ran ${ranCount} migration(s).`);
  }
}

// Allow standalone execution: ts-node src/config/migrationRunner.ts
// or: node dist/config/migrationRunner.js
if (require.main === module) {
  // Init Sentry locally so a startup-time crash (e.g. DB connect failure)
  // gets reported. The main server initializes its own in instrument.ts.
  if (env.SENTRY_DSN) {
    Sentry.init({
      dsn: env.SENTRY_DSN,
      environment: env.NODE_ENV,
      tracesSampleRate: 0,
      sendDefaultPii: false,
    });
  }

  runMigrations()
    .then(() => {
      logger.info('Migrations complete!');
      process.exit(0);
    })
    .catch(async (err) => {
      logger.error('Migration failed', { error: err.message, stack: err.stack });
      Sentry.captureException(err);
      await Sentry.flush(2000).catch(() => undefined);
      process.exit(1);
    });
}
