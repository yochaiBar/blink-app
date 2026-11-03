import './instrument';

import http from 'http';
import * as Sentry from '@sentry/node';

import { env } from './config/env';
import pool from './config/database';
import { runMigrations } from './config/migrationRunner';
import { createApp } from './app';
import logger from './utils/logger';
import { registerRelayHub, expireStalePendingPickups } from './services/relayHub';
import { registerKeyshareHub, expireStalePendingJoins } from './services/keyshareHub';
import { OTP_RATE_LIMIT_PER_HOUR } from './utils/constants';
import { initSocket } from './socket';
import { startChallengeJobs } from './jobs/challengeJobs';
import { startDailyChallengeJob } from './jobs/dailyChallenge';

const PORT = env.PORT;

// Expire stale pending_photo_pickups + pending_joins every hour. Both
// queries are single indexed UPDATEs; cheap enough to run frequently.
// 7-day TTLs are enforced inside the expire* helpers.
const PENDING_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

function startPendingCleanup(): void {
  setInterval(() => {
    expireStalePendingPickups()
      .then((count) => {
        if (count > 0) logger.info('expired stale pending pickups', { count });
      })
      .catch((err: unknown) => {
        logger.error('pending pickup cleanup failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    expireStalePendingJoins()
      .then((count) => {
        if (count > 0) logger.info('expired stale pending joins', { count });
      })
      .catch((err: unknown) => {
        logger.error('pending join cleanup failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }, PENDING_CLEANUP_INTERVAL_MS).unref();
}

async function main(): Promise<void> {
  // Versioned migrations run before we accept traffic. Each one runs in its
  // own transaction under an advisory lock, so concurrent boots serialize.
  await runMigrations();

  const app = createApp();

  // Create HTTP server and initialize Socket.io
  const server = http.createServer(app);
  const io = initSocket(server);

  // Wire the photo relay's pickup-on-connect listener. Must come after
  // initSocket so the socket module's onUserConnect registry exists.
  registerRelayHub();
  // Wire the group-key courier handshake's connect listener too.
  registerKeyshareHub();

  server.listen(PORT, () => {
    logger.info(`Blink server running on port ${PORT}`);
    logger.info(`Environment: ${env.NODE_ENV}`);
    logger.info(`OTP rate limit: ${OTP_RATE_LIMIT_PER_HOUR}/hour`);
    if (OTP_RATE_LIMIT_PER_HOUR > 10) {
      logger.warn(
        `OTP rate limit is set to ${OTP_RATE_LIMIT_PER_HOUR}/hour. This is above the recommended production value of 3. Ensure OTP_RATE_LIMIT_PER_HOUR is not set in production.`,
      );
    }

    // Challenge expiry + reminders (always), daily auto-challenge (if enabled)
    startChallengeJobs();
    startDailyChallengeJob();
    startPendingCleanup();
  });

  // ── Graceful shutdown ─────────────────────────────────────────
  function gracefulShutdown(signal: string) {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);

    // Stop accepting new connections
    server.close(async () => {
      logger.info('HTTP server closed');

      // Close Socket.io connections
      io.close();
      logger.info('Socket.io server closed');

      // Close database pool
      try {
        await pool.end();
        logger.info('Database pool closed');
      } catch (err: unknown) {
        logger.error('Error closing database pool', { error: err instanceof Error ? err.message : String(err) });
      }

      logger.info('Graceful shutdown complete');
      process.exit(0);
    });

    // Force exit after 30 seconds if graceful shutdown hangs
    setTimeout(() => {
      logger.error('Graceful shutdown timed out after 30s, forcing exit');
      process.exit(1);
    }, 30_000).unref();
  }

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

main().catch(async (err: unknown) => {
  logger.error('Server failed to start', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  Sentry.captureException(err);
  await Sentry.flush(2000).catch(() => undefined);
  process.exit(1);
});
