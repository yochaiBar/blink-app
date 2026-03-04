/**
 * Test Setup - blink-server
 *
 * Configures the test environment with:
 * - Environment variables for JWT secrets
 * - Database mock (all SQL queries are intercepted)
 * - Firebase mock (disabled for test mode)
 * - Socket.io mock (emitToGroup is a no-op spy)
 * - Logger suppression (no console noise during tests)
 */

// ── Environment variables must be set before any imports ──────────
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-for-unit-tests';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-for-unit-tests';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/blink_test';
process.env.PORT = '0'; // Use random port for tests

// ── Mock the database module ──────────────────────────────────────
// Every test file can control what `query()` returns by setting up
// mockResolvedValueOnce / mockImplementation on the mock.
jest.mock('../config/database', () => {
  const mockQuery = jest.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  return {
    query: mockQuery,
    __esModule: true,
    default: {
      query: mockQuery,
      end: jest.fn(),
    },
  };
});

// ── Mock Firebase (always disabled in tests) ──────────────────────
jest.mock('../config/firebase', () => ({
  isFirebaseConfigured: false,
  verifyFirebaseToken: jest.fn().mockRejectedValue(new Error('Firebase not configured in tests')),
  __esModule: true,
  default: null,
}));

// ── Mock Socket.io ────────────────────────────────────────────────
jest.mock('../socket', () => ({
  emitToGroup: jest.fn(),
  initSocket: jest.fn().mockReturnValue({}),
  getIO: jest.fn().mockReturnValue(null),
}));

// ── Mock notification utility ─────────────────────────────────────
jest.mock('../utils/notifications', () => ({
  createNotification: jest.fn().mockResolvedValue(undefined),
}));

// ── Mock push notifications service ──────────────────────────────
jest.mock('../services/pushNotifications', () => ({
  sendPushNotification: jest.fn().mockResolvedValue(undefined),
  sendPushToGroup: jest.fn().mockResolvedValue(undefined),
  sendPushToUser: jest.fn().mockResolvedValue(undefined),
}));

// ── Suppress logger output during tests ───────────────────────────
jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  __esModule: true,
  default: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

// ── Global cleanup ───────────────────────────────────────────────
afterEach(() => {
  jest.clearAllMocks();
});

afterAll(() => {
  jest.restoreAllMocks();
});
