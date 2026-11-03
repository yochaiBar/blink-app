import type { PoolClient } from 'pg';
import pool, { query } from '../../config/database';

let tableList: string | null = null;

/** Empty every table except schema_migrations. */
export async function truncateAllTables(): Promise<void> {
  if (tableList === null) {
    const result = await query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> 'schema_migrations'
        ORDER BY tablename`,
    );
    // Names come from the catalog, not from user input.
    tableList = result.rows.map((r) => `"${r.tablename}"`).join(', ');
  }
  if (tableList) {
    await query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);
  }
}

async function waitForLockWaiters(client: PoolClient, waiters: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // pg_stat_activity is snapshotted once per transaction; refresh it so
    // backends that connected after the first poll are visible.
    await client.query('SELECT pg_stat_clear_snapshot()');
    const result = await client.query<{ count: string }>(
      `SELECT COUNT(DISTINCT l.pid) AS count
         FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE NOT l.granted AND a.datname = current_database()`,
    );
    if (parseInt(result.rows[0].count, 10) >= waiters) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * Force the worst-case interleaving for a race test instead of hoping for it.
 *
 * Holds an EXCLUSIVE lock on `table` (reads still succeed, writes block)
 * while `fire()` starts the concurrent requests, waits until `waiters`
 * backends are blocked on some lock (or `timeoutMs` passes — a correctly
 * serialized implementation may queue elsewhere), then releases so they all
 * proceed at once. Returns what `fire()` resolves to.
 */
export async function raceBehindLock<T>(
  table: string,
  waiters: number,
  fire: () => Promise<T>,
  timeoutMs = 3000,
): Promise<T> {
  if (!/^[a-z_]+$/.test(table)) throw new Error(`Unexpected table name: ${table}`);
  const client = await pool.connect();
  let pending: Promise<T> | undefined;
  try {
    await client.query('BEGIN');
    await client.query(`LOCK TABLE ${table} IN EXCLUSIVE MODE`);
    pending = fire();
    await waitForLockWaiters(client, waiters, timeoutMs);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  return pending;
}

/**
 * Routes kick off fire-and-forget work (notifications, streaks, completion
 * checks) after responding. Wait until the pool has been quiet for a short
 * window so that work can't leak into the next test's truncate.
 */
export async function waitForDbIdle(timeoutMs = 5000, quietMs = 100): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let quietSince: number | null = null;
  while (Date.now() < deadline) {
    const busy = pool.totalCount - pool.idleCount + pool.waitingCount;
    if (busy === 0) {
      quietSince ??= Date.now();
      if (Date.now() - quietSince >= quietMs) return;
    } else {
      quietSince = null;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
