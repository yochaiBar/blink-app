/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/__tests__'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  clearMocks: true,
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      diagnostics: false,
      tsconfig: {
        jsx: 'react-jsx',
        esModuleInterop: true,
        strict: true,
        moduleResolution: 'node',
        paths: {
          '@/*': ['./*'],
        },
      },
    }],
    '^.+\\.jsx?$': 'babel-jest',
  },
  transformIgnorePatterns: [
    // @noble/* ships as ESM-only in v2.x; let Jest transform it so test files
    // that exercise the real crypto can import it.
    'node_modules/(?!(expo-.*|@expo/.*|react-native|@react-native|zustand|@noble)/)',
  ],
  collectCoverageFrom: [
    'utils/**/*.ts',
    'services/**/*.ts',
    'stores/**/*.ts',
    '!**/*.d.ts',
  ],
  coverageDirectory: 'coverage',
  verbose: true,
  testTimeout: 10000,
};
