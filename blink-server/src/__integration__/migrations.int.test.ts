/**
 * withTransaction and the migration runner against real Postgres.
 * (globalSetup has already migrated this database from scratch.)
 */
import { query, withTransaction } from '../config/database';
import { runMigrations } from '../config/migrationRunner';

async function appliedMigrations() {
  const result = await query<{ filename: string; applied_at: Date }>(
    'SELECT filename, applied_at FROM schema_migrations ORDER BY id',
  );
  return result.rows;
}

describe('withTransaction', () => {
  it('rolls back every statement, DDL included, when the callback throws', async () => {
    await expect(
      withTransaction(async (client) => {
        await client.query('CREATE TABLE rollback_probe (id INT)');
        await client.query('INSERT INTO rollback_probe VALUES (1)');
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const table = await query(`SELECT to_regclass('public.rollback_probe') AS t`);
    expect(table.rows[0].t).toBeNull();
  });

  it('commits when the callback resolves', async () => {
    const id = await withTransaction(async (client) => {
      const res = await client.query<{ id: string }>(
        `INSERT INTO users (phone_number) VALUES ('+15550009999') RETURNING id`,
      );
      return res.rows[0].id;
    });

    const row = await query('SELECT id FROM users WHERE id = $1', [id]);
    expect(row.rows).toHaveLength(1);
  });
});

describe('runMigrations', () => {
  beforeEach(() => {
    // The runner logs one line per file; keep test output readable.
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('has applied every migration file exactly once', async () => {
    const rows = await appliedMigrations();

    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.filename)).size).toBe(rows.length);
  });

  it('refuses to run on a database with migrations it does not know', async () => {
    await query(`INSERT INTO schema_migrations (filename) VALUES ('009_encrypted_photos.sql')`);
    try {
      await expect(runMigrations()).rejects.toThrow(/009_encrypted_photos\.sql.*predates/);
    } finally {
      await query(`DELETE FROM schema_migrations WHERE filename = '009_encrypted_photos.sql'`);
    }
  });

  it('is a no-op when re-run, even by concurrent runners', async () => {
    const before = await appliedMigrations();

    await Promise.all([runMigrations(), runMigrations(), runMigrations()]);

    expect(await appliedMigrations()).toEqual(before);
  });
});
