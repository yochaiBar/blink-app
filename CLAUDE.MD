# Blink Project

## Start here
- **Roadmap (source of truth for what we do now / next / not):** Obsidian vault `~/Documents/Obsidian Vault/Blink/Plans/00 - Roadmap.md`. Recovery plan: `Plans/תוכנית הבראה.md`.
- **Product (post-recovery):** private friend groups + one timed snap challenge a day. Photos are end-to-end encrypted and relayed device→device — **the server never stores photos or group keys.** Also: reactions, photo comments, streaks + leaderboard, a demo group for new users. Removed on purpose: AI features, quiz/prompt challenges, World/For You lanes, spotlight.

## Team Mode (preferred for almost all cases)
1. Always utilize context7 when necessary to learn from docs.
2. Prefer team mode. Agents to use constantly:
   - Senior product manager expert in B2C and viral social media apps.
   - Senior full stack developer expert in mobile development for both iOS and Android.

## Quick Reference
- **App:** `blink-app/` -- Expo SDK 54, React Native 0.81, expo-router (typed routes), Zustand, React Query
- **Server:** `blink-server/` -- Express, PostgreSQL, JWT sessions, Socket.io
- **Install:** `npm ci --legacy-peer-deps --registry https://registry.npmjs.org` (app) / `npm ci --registry https://registry.npmjs.org` (server)
- **Test:** `npm test` in each directory (server: unit project). Server integration tests: `docker compose up -d postgres`, then `TEST_DATABASE_URL=postgresql://blink:blink_dev_password@localhost:5432/blink_test npm run test:integration` in `blink-server/`
- **Typecheck:** `npm run typecheck` in each directory
- **Lint:** `npm run lint` in each directory (0 errors is enforced in CI)
- **Dev server:** `cd blink-server && npm run dev` (port 3000)
- **Dev app:** `cd blink-app && npx expo start` (dev builds talk to your machine's LAN address, never production)
- **Deploy:** `railway up --service blink-api --detach` from the **repo root** (NOT `blink-server/`). `railway.toml` sets `dockerfilePath = "Dockerfile"` (repo root) and the Dockerfile uses `COPY blink-server/...` paths — deploying from inside `blink-server/` uploads the wrong build context and the build fails silently while Railway keeps serving the old container.

## Code Conventions
- TypeScript strict mode in both packages
- Single quotes, trailing commas, 120 char width, 2-space indent (see .prettierrc; husky pre-commit runs lint-staged)
- snake_case for DB columns and API request/response fields, camelCase for TypeScript variables
- Zod schema required for every POST/PATCH request body and for query strings (see `blink-server/src/utils/schemas.ts`, `middleware/validate.ts`)
- Error responses always: `{ error: string }` — throw `HttpError` (`utils/httpError.ts`); the global error handler formats it
- All SQL queries use parameterized `$1, $2` -- NEVER string interpolation (including intervals: use `make_interval(... => $n)`)
- Async route handlers wrapped with `asyncHandler` (see `blink-server/src/middleware/asyncHandler.ts`)
- Membership checks go through `requireMember` / `requireVisibleResponse` (`services/membership.ts`); recipients of anything an actor does come from `audience()` (`services/audience.ts`) so blocks apply everywhere
- Read other users' names from the `public_users` view — never `phone_number` outside auth
- `process.env` is read only in `blink-server/src/config/env.ts` (Zod-validated)
- Any API/protocol contract change updates server, app and both copies of `photoProtocol.ts` (`blink-server/src/shared/`, `blink-app/shared/` — CI checks they're identical) in the same PR

## File Organization
- Routes: `blink-server/src/routes/` (one file per resource; `challenges/`, `photos/relay.ts`, `keyshare.ts`, `deviceKeys.ts`, `feed.ts`, `joinPage.ts`, `wellKnown.ts`)
- Middleware: `blink-server/src/middleware/` (auth.ts, validate.ts, params.ts — UUID params via `router.param`, asyncHandler.ts)
- App vs boot: `blink-server/src/app.ts` (`createApp()`) and `src/server.ts` (listen, sockets, jobs)
- DB: `blink-server/src/config/database.ts`; migrations in `src/config/migrations/` run by `migrationRunner.ts` (`001_baseline.sql` is the whole schema; editable in place until the first production deploy of the recovery, then frozen — new changes go in `002_*` and up)
- Services: `blink-server/src/services/` — `authSessions`, `otp`, `membership`, `audience`, `challengeLifecycle` (create/respond/finalize, exactly-once), `challengeReads`, `relayHub` (photo relay + pickup leases), `keyshareHub` (group-key courier), `pushNotifications`, `groupService`
- Jobs: `blink-server/src/jobs/` (`challengeJobs` expiry/reminders, `dailyChallenge` scheduler)
- App screens: `blink-app/app/` (expo-router file-based routing; typed routes — no `as never` casts)
- Reusable components: `blink-app/components/`
- API client: `blink-app/services/api.ts` (JWT, single-flight refresh, `ApiError` with status; a refused refresh signs out)
- Realtime: `blink-app/services/socket.ts` + all handlers in `services/socketEvents.ts`
- E2E: `blink-app/services/{groupCrypto,photoTransfer,keyTransfer,keyPins,photoStore,relayRetry}.ts`
- Demo group: `blink-app/services/demoSource.ts` (hooks route demo ids there; screens never branch on the demo)
- State: Zustand stores in `blink-app/stores/`, React Query for server state

## Testing Requirements
- Backend unit: Jest + Supertest with a mocked DB (`__tests__/setup.ts`).
- **Backend integration: every change that touches SQL ships with a test against real Postgres** (`src/__integration__/`). Mocked tests can't catch wrong columns, FK violations or races — that's how past prod bugs got in.
- Frontend: Jest + @testing-library/react-native. Test utils, services and critical hooks.
- Run before committing: typecheck + lint + tests in both packages, plus server integration.
- Currently (2026-11-03): server ~64 unit + ~111 integration, app ~259.

## Security Rules
- NEVER use string interpolation in SQL queries -- always parameterized ($1, $2)
- NEVER return raw error messages in production (500s get generic message)
- NEVER accept photo bytes or photo URLs on the server — photos travel only E2E-encrypted through the relay (CI greps for `photo_url`)
- NEVER store secrets in code -- use environment variables
- NEVER hard-code a link or email domain — invite-link domain and support email are config (`EXPO_PUBLIC_LINK_DOMAIN`, `EXPO_PUBLIC_SUPPORT_EMAIL`)
- Rate limit all public endpoints (see `app.ts`)
- Validate all route params as UUID (`middleware/params.ts`)
- Auth: 15-min access JWT `{sub, sid}` + rotating opaque refresh token per `auth_sessions` row; reuse of a stale refresh token revokes the session; logout revokes; sockets re-check the session
- OTP codes are stored as HMAC (`OTP_PEPPER`), max 5 attempts. Production refuses to boot without Twilio + `OTP_PEPPER`; there is no universal-code bypass (an App Review login exists only when `APP_REVIEW_PHONE`/`APP_REVIEW_OTP` are set)
- What E2E does and doesn't protect is in `SECURITY.md` — keep it honest when changing the crypto

## Common Gotchas
- `npm install` needs `--legacy-peer-deps` in blink-app (lucide-react-native peer dep conflict)
- `npm install` needs `--registry https://registry.npmjs.org` (stale CodeArtifact config in ~/.npmrc)
- Dev OTP code 123456 works only outside production when Twilio isn't configured
- No Firebase anywhere -- auth is server-side Twilio OTP, push is Expo Push API
- Socket.io events trigger React Query cache invalidation on the client (`services/socketEvents.ts`); events carry ids, content comes from REST
- A database migrated by the pre-recovery 001–016 files won't boot (the runner refuses unknown `schema_migrations` rows) — use a fresh database
- Expo Go can't run the full camera/splash flow (SDK 53+) — validate snaps in a dev or TestFlight build

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
