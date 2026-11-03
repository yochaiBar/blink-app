const tsPlugin = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');

module.exports = [
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearTimeout: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'warn',
      // Config is read in one place, validated by its Zod schema.
      'no-restricted-properties': [
        'error',
        {
          object: 'process',
          property: 'env',
          message: 'Read configuration from config/env.ts (`env`), not process.env.',
        },
      ],
      // Phone numbers are private: outside auth, names come from the
      // public_users view, never from users.phone_number.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/phone_number/], TemplateElement[value.raw=/phone_number/]',
          message: 'phone_number is private to auth; select display names from public_users.',
        },
      ],
    },
  },
  {
    // Where the restricted things legitimately live.
    files: ['src/config/env.ts', 'src/__integration__/**/*.ts'],
    rules: { 'no-restricted-properties': 'off' },
  },
  {
    files: ['src/routes/auth.ts', 'src/services/otp.ts', 'src/__integration__/**/*.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    ignores: ['dist/', 'node_modules/', 'coverage/', 'src/__tests__/'],
  },
];
