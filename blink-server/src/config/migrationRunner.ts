import { query } from './database';
import fs from 'fs';
import path from 'path';
import logger from '../utils/logger';

// Create tracking table
async function ensureMigrationsTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

// Get list of already-applied migrations
async function getAppliedMigrations(): Promise<string[]> {
  const result = await query<{ filename: string }>('SELECT filename FROM schema_migrations ORDER BY id');
  return result.rows.map(r => r.filename);
}

// Run all pending migrations in order
export async function runMigrations(): Promise<void> {
  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();

  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort(); // Alphabetical = chronological with NNN_ prefix

  let ranCount = 0;

  for (const file of files) {
    if (applied.includes(file)) {
      logger.info(`Migration already applied: ${file}`);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    logger.info(`Running migration: ${file}`);

    await query('BEGIN');
    try {
      await query(sql);
      await query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
      await query('COMMIT');
      logger.info(`Migration complete: ${file}`);
      ranCount++;
    } catch (err) {
      await query('ROLLBACK');
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
  runMigrations()
    .then(() => {
      logger.info('Migrations complete!');
      process.exit(0);
    })
    .catch((err) => {
      logger.error('Migration failed', { error: err.message });
      process.exit(1);
    });
}
