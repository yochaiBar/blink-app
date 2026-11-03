/**
 * Jest globalSetup for the integration project: wipe the test database's
 * public schema and rebuild it with the real migration runner, exactly as a
 * fresh production database would be built.
 */
import { Client } from 'pg';
import { applyIntegrationEnv, testDatabaseName } from './testEnv';

async function ensureDatabaseExists(url: string): Promise<void> {
  const probe = new Client({ connectionString: url });
  try {
    await probe.connect();
    return;
  } catch (err) {
    // 3D000 = invalid_catalog_name: the database does not exist yet.
    if ((err as { code?: string }).code !== '3D000') throw err;
  } finally {
    await probe.end().catch(() => undefined);
  }

  const name = testDatabaseName(url);
  if (!/^[A-Za-z0-9_]+$/.test(name)) {
    throw new Error(`Cannot auto-create database with unusual name "${name}"; create it manually.`);
  }
  const adminUrl = new URL(url);
  adminUrl.pathname = '/postgres';
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    // Identifier, not a value — validated above, so quoting is safe.
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }
}

export default async function globalSetup(): Promise<void> {
  applyIntegrationEnv();
  const url = process.env.DATABASE_URL as string;

  await ensureDatabaseExists(url);

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }

  // Imported lazily so the pool is created after DATABASE_URL points at the
  // test database. The runner's per-file logging is muted to keep output short.
  const { runMigrations } = await import('../../config/migrationRunner');
  const { default: pool } = await import('../../config/database');
  /* eslint-disable no-console */
  const originalLog = console.log;
  console.log = () => undefined;
  try {
    await runMigrations();
  } finally {
    console.log = originalLog;
    await pool.end();
  }
  /* eslint-enable no-console */
}
