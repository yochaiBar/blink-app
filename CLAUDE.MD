# Blink Project

## Team Mode (preferred for almost all cases)
1. Always utilize context7 when necessary to learn from docs.
2. Prefer team mode. Agents to use constantly:
   - Senior product manager expert in B2C and viral social media apps.
   - Senior full stack developer expert in mobile development for both iOS and Android.

## Quick Reference
- **App:** `blink-app/` -- Expo SDK 54, React Native 0.81, expo-router, Zustand, React Query
- **Server:** `blink-server/` -- Express, PostgreSQL, JWT auth, Socket.io
- **Install:** `npm ci --legacy-peer-deps --registry https://registry.npmjs.org` (app) / `npm ci --registry https://registry.npmjs.org` (server)
- **Test:** `npm test` in each directory
- **Typecheck:** `npm run typecheck` in each directory
- **Lint:** `npm run lint` in each directory
- **Dev server:** `cd blink-server && npm run dev` (port 3000)
- **Dev app:** `cd blink-app && npx expo start`
- **Deploy:** `cd blink-server && railway up --service blink-api --detach`

## Code Conventions
- TypeScript strict mode in both packages
- Single quotes, trailing commas, 120 char width, 2-space indent (see .prettierrc)
- snake_case for DB columns and API request/response fields, camelCase for TypeScript variables
- Zod schema required for every POST/PATCH request body (see `blink-server/src/utils/schemas.ts`)
- Error responses always: `{ error: string }`
- All SQL queries use parameterized `$1, $2` -- NEVER string interpolation
- URL fields (photo_url, avatar_url) must be validated against S3 bucket domain
- Async route handlers wrapped with `asyncHandler` (see `blink-server/src/middleware/asyncHandler.ts`)

## File Organization
- Routes: `blink-server/src/routes/` (one file per resource)
- Middleware: `blink-server/src/middleware/` (auth.ts, validate.ts, validateParams.ts, asyncHandler.ts)
- DB config + migrations: `blink-server/src/config/database.ts`, `blink-server/src/config/migrate.ts`
- Validation schemas: `blink-server/src/utils/schemas.ts`
- Constants: `blink-server/src/utils/constants.ts`
- Logger: `blink-server/src/utils/logger.ts` (structured JSON)
- Services: `blink-server/src/services/` (aiService, contentModeration, pushNotifications)
- App screens: `blink-app/app/` (expo-router file-based routing)
- Reusable components: `blink-app/components/`
- API client: `blink-app/services/api.ts` (auto-attaches JWT, retries on 401 with refresh)
- Socket client: `blink-app/services/socket.ts`
- State: Zustand stores in `blink-app/stores/` (auth, onboarding), React Query for server state

## Testing Requirements
- Backend: Jest + Supertest. Every new route needs tests. Mock DB via setup.ts.
- Frontend: Jest + @testing-library/react-native. Test utils and critical hooks.
- Run full suite before committing: `cd blink-server && npm test && cd ../blink-app && npm test`
- Currently: ~180 backend tests, ~74 frontend tests.

## Security Rules
- NEVER use string interpolation in SQL queries -- always parameterized ($1, $2)
- NEVER return raw error messages in production (500s get generic message)
- NEVER accept arbitrary URLs -- validate against S3 bucket domain
- NEVER store secrets in code -- use environment variables
- Rate limit all public endpoints (see rate limit config in index.ts)
- Validate all route params as UUID format (validateParams middleware)
- Auth: JWT access tokens (15m) + refresh tokens (7d), revocation via revoked_tokens table

## Common Gotchas
- `npm install` needs `--legacy-peer-deps` in blink-app (lucide-react-native peer dep conflict)
- `npm install` needs `--registry https://registry.npmjs.org` (stale CodeArtifact config in ~/.npmrc)
- Dev OTP code is 123456 (works when Twilio env vars not set or ALLOW_DEV_OTP_FALLBACK=true)
- In production, NODE_ENV=production disables dev OTP fallback
- No Firebase anywhere -- auth is server-side Twilio OTP, push is Expo Push API
- Socket.io events trigger React Query cache invalidation on the client (useSocket hook)
- AI features have hardcoded fallbacks -- app works without ANTHROPIC_API_KEY
- S3 uploads have dev fallback -- app works without AWS env vars (uses local URIs)
