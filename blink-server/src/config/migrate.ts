// Legacy entry point -- delegates to the versioned migration runner.
// Kept so that existing scripts (start:prod, Dockerfile CMD) continue to work.
import { runMigrations } from './migrationRunner';
import logger from '../utils/logger';

runMigrations()
  .then(() => {
    logger.info('Migrations complete!');
    process.exit(0);
  })
  .catch((err) => {
    logger.error('Migration failed', { error: err.message });
    process.exit(1);
  });
