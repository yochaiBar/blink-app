// Jest `setupFiles`: runs in each integration test file before any app
// module is imported, so config/env.ts and config/database.ts see these.
import { applyIntegrationEnv } from './testEnv';

applyIntegrationEnv();
