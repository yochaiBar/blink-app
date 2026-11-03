/**
 * Write expo-router's typed-routes declarations (.expo/types/router.d.ts)
 * without starting Metro, so `npm run typecheck` (and CI) check every
 * router.push / <Link> against the real routes in app/.
 */
const fs = require('fs');
const path = require('path');
const { regenerateDeclarations } = require('expo-router/build/typed-routes');
const requireContext = require('expo-router/build/testing-library/require-context-ponyfill').default;

const appDir = path.join(__dirname, '..', 'app');
const outputDir = path.join(__dirname, '..', '.expo', 'types');

fs.mkdirSync(outputDir, { recursive: true });
regenerateDeclarations(outputDir, {}, requireContext(appDir, true, /\.[tj]sx?$/));
