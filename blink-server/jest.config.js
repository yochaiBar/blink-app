// Shared per-project settings (ts-jest + ESM-only package mapping).
const base = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // Map ESM-only packages to their CJS entry points
    '^zod$': require.resolve('zod'),
  },
  clearMocks: true,
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        diagnostics: false,
      },
    ],
  },
  // Allow transforming ESM packages
  transformIgnorePatterns: ['node_modules/(?!(zod)/)'],
};

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  projects: [
    {
      ...base,
      // Fast, DB-mocked route/service tests (`npm test`).
      displayName: 'unit',
      testMatch: ['**/__tests__/**/*.test.ts'],
    },
    {
      ...base,
      // Real Postgres + real Socket.io (`npm run test:integration`, needs
      // TEST_DATABASE_URL). See src/__integration__/README.md.
      displayName: 'integration',
      testMatch: ['**/__integration__/**/*.int.test.ts'],
      globalSetup: '<rootDir>/src/__integration__/support/globalSetup.ts',
      setupFiles: ['<rootDir>/src/__integration__/support/env.ts'],
      setupFilesAfterEnv: ['<rootDir>/src/__integration__/support/perTest.ts'],
    },
  ],
  collectCoverageFrom: ['src/routes/**/*.ts', 'src/middleware/**/*.ts', 'src/utils/**/*.ts', '!src/**/*.d.ts'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'clover'],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
  verbose: true,
  testTimeout: 15000,
};
