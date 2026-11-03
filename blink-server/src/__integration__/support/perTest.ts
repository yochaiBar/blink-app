// Jest `setupFilesAfterEnv` for the integration project.
import pool from '../../config/database';
import { truncateAllTables, waitForDbIdle } from './db';
import { installHttpStubs, resetHttpStubs, uninstallHttpStubs } from './httpStubs';

installHttpStubs();

beforeEach(async () => {
  await truncateAllTables();
  resetHttpStubs();
});

afterEach(async () => {
  await waitForDbIdle();
});

afterAll(async () => {
  await waitForDbIdle();
  await pool.end();
  uninstallHttpStubs();
});
