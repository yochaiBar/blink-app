# Blink Codebase Improvement Plan

> Generated: 2026-03-12 | Current weighted score: ~27/100 | Target: 80/100

---

## Current Assessment Scores

| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Type Safety | 42/100 | 20% | 8.4 |
| Test Foundation | 3/100 | 15% | 0.5 |
| Documentation & Context | 18/100 | 15% | 2.7 |
| Code Clarity | 45/100 | 15% | 6.8 |
| Architecture Clarity | 35/100 | 15% | 5.3 |
| Feedback Loops | 4/100 | 10% | 0.4 |
| Consistency & Conventions | 12/100 | 5% | 0.6 |
| Change Safety | 18/100 | 5% | 0.9 |
| **Total** | | | **25.6** |

---

## Phase 1: Quick Wins (1-3 days)

> **Target score: ~41/100** | Highest ROI, lowest effort

### 1.1 Security: Fix Dev OTP Fallback Default
- **File:** `blink-server/src/routes/auth.ts:16`
- **Problem:** `ALLOW_DEV_OTP_FALLBACK` defaults to `true`. In production, if Twilio fails, anyone can use code `123456`.
- **Fix:** Default to `false` when `NODE_ENV === 'production'`:
  ```typescript
  const ALLOW_DEV_OTP_FALLBACK = process.env.NODE_ENV !== 'production'
    && process.env.ALLOW_DEV_OTP_FALLBACK !== 'false';
  ```
- **Priority:** P0 | **Effort:** S | **Improves:** Change Safety

### 1.2 Security: Fix Socket.io Group Join Authorization
- **File:** `blink-server/src/socket/index.ts:35-37`
- **Problem:** Any authenticated user can join any group room and receive events for groups they're not in.
- **Fix:** Validate group membership before `socket.join`:
  ```typescript
  socket.on('join-groups', async (groupIds: string[]) => {
    const result = await query(
      `SELECT group_id FROM group_members WHERE user_id = $1 AND group_id = ANY($2)`,
      [socket.data.userId, groupIds]
    );
    result.rows.map(r => r.group_id).forEach(id => socket.join(`group:${id}`));
  });
  ```
- **Priority:** P0 | **Effort:** S | **Improves:** Change Safety

### 1.3 Security: Fix Error Handler Leaking Internal Messages
- **File:** `blink-server/src/index.ts:154-159`
- **Problem:** Error handler returns `err.message` directly — leaks SQL details, table names, constraint names.
- **Fix:** Return generic message for 500 errors:
  ```typescript
  const message = status < 500 ? err.message : 'Internal server error';
  ```
- **Priority:** P0 | **Effort:** S | **Improves:** Change Safety

### 1.4 Type Safety: Validated Environment Config
- **File:** Create `blink-server/src/config/env.ts`
- **Problem:** 6 `process.env.X!` non-null assertions. Missing env vars cause cryptic runtime errors.
- **Fix:** Zod-validated env module:
  ```typescript
  import { z } from 'zod';
  const envSchema = z.object({
    JWT_SECRET: z.string().min(16),
    JWT_REFRESH_SECRET: z.string().min(16),
    DATABASE_URL: z.string(),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3000),
  });
  export const env = envSchema.parse(process.env);
  ```
  Replace all `process.env.JWT_SECRET!` with `env.JWT_SECRET`.
- **Priority:** P0 | **Effort:** S | **Improves:** Type Safety +5, Change Safety +5

### 1.5 Type Safety: Generic `api<T>()` Function
- **File:** `blink-app/services/api.ts:90`
- **Problem:** `api()` returns `Promise<any>` — the single biggest type hole. Every caller inherits `any`.
- **Fix:** `async function api<T = unknown>(path: string, options?: RequestInit): Promise<T>`. Update all 15+ call sites.
- **Priority:** P0 | **Effort:** M | **Improves:** Type Safety +15, Change Safety +10

### 1.6 Consistency: Add ESLint + Prettier
- **Files:** Create `blink-app/eslint.config.js`, `blink-server/.eslintrc.js`, root `.prettierrc`
- **Problem:** No linter or formatter configured. Code style is convention only. ESLint is installed but has no config.
- **Fix:**
  - App: `eslint.config.js` extending `eslint-config-expo`, add `no-explicit-any: warn`
  - Server: `.eslintrc.js` with `@typescript-eslint/recommended`
  - Root: `.prettierrc` with `singleQuote: true, trailingComma: 'all', printWidth: 120`
  - Add `"lint"` and `"format"` scripts to both `package.json` files
- **Priority:** P0 | **Effort:** S | **Improves:** Consistency +30, Code Clarity +5

### 1.7 Feedback: Pre-commit Hooks (Husky + lint-staged)
- **Files:** Root `package.json`, `.husky/pre-commit`, `.lintstagedrc`
- **Problem:** No automated quality gates before code enters the repo.
- **Fix:** `husky` + `lint-staged` at repo root. Pre-commit runs ESLint + Prettier on staged files.
- **Priority:** P0 | **Effort:** S | **Improves:** Change Safety +20, Feedback Loops +15

### 1.8 Documentation: Create ARCHITECTURE.md
- **File:** Create `/ARCHITECTURE.md`
- **Problem:** No architectural documentation. New developers can't understand the system.
- **Content:** Directory map, tech stack table, data flow (client → API → PostgreSQL), auth flow (OTP → JWT), file upload (presign → S3), Socket.io events, API route table, DB schema overview.
- **Priority:** P1 | **Effort:** S | **Improves:** Documentation +35, Architecture +15

### 1.9 Documentation: Expand CLAUDE.md
- **File:** Update `/CLAUDE.md`
- **Problem:** Currently 5 lines of vague guidance.
- **Content:** Code style conventions, naming patterns, file organization rules, testing requirements, error response format, PR checklist.
- **Priority:** P1 | **Effort:** S | **Improves:** Documentation +15, Consistency +10

### 1.10 DX: Add `.npmrc`
- **File:** Create `blink-app/.npmrc`
- **Problem:** `npm install` requires `--legacy-peer-deps` and `--registry` flags — tribal knowledge.
- **Fix:** `legacy-peer-deps=true` and `registry=https://registry.npmjs.org`
- **Priority:** P0 | **Effort:** S | **Improves:** Consistency +5

---

## Phase 2: Foundation (1-2 weeks)

> **Target score: ~53/100** | Essential infrastructure

### 2.1 CI Pipeline (GitHub Actions)
- **File:** Create `.github/workflows/ci.yml`
- **Jobs:** `server-checks` (install, tsc, lint, test) + `app-checks` (install, tsc, lint, test)
- **Priority:** P0 | **Effort:** M | **Improves:** Feedback Loops +40, Change Safety +20, Test Foundation +10

### 2.2 Database Transactions for Multi-Step Operations
- **File:** `blink-server/src/config/database.ts` + route files
- **Problem:** Critical operations (group creation, challenge response, account deletion) use sequential queries without transactions. Partial failures corrupt data.
- **Fix:** Add `withTransaction<T>()` helper. Wrap group creation, challenge response, admin transfer, account deletion.
- **Priority:** P0 | **Effort:** M | **Improves:** Change Safety +10, Architecture +5

### 2.3 Split challenges.ts Monolith (1,184 lines)
- **File:** `blink-server/src/routes/challenges.ts`
- **Target structure:**
  - `routes/challenges/index.ts` — router setup
  - `routes/challenges/create.ts` — POST create
  - `routes/challenges/respond.ts` — POST respond + moderation
  - `routes/challenges/reactions.ts` — reactions CRUD
  - `routes/challenges/queries.ts` — GET endpoints
  - `services/challengeService.ts` — shared business logic
- **Priority:** P1 | **Effort:** M | **Improves:** Architecture +10, Code Clarity +10, Change Safety +5

### 2.4 Split group-detail.tsx God-Screen (1,808 lines)
- **File:** `blink-app/app/group-detail.tsx`
- **Target structure:**
  - `components/group-detail/GroupDetailHeader.tsx`
  - `components/group-detail/MemberRingRow.tsx`
  - `components/group-detail/ChallengeSection.tsx`
  - `components/group-detail/SnapGrid.tsx`
  - `components/group-detail/GroupSettingsModal.tsx`
  - `components/group-detail/ChallengeTypeSelector.tsx`
  - Main screen file under 300 lines
- **Priority:** P0 | **Effort:** L | **Improves:** Code Clarity +20, Change Safety +15, Architecture +10

### 2.5 Split AppProvider into Domain Hooks
- **File:** `blink-app/providers/AppProvider.tsx` (380 lines, 28 exports)
- **Problem:** Every context consumer re-renders when ANY value changes.
- **Target structure:**
  - `hooks/useGroups.ts` — group queries + mutations
  - `hooks/useActivity.ts` — activity feed
  - `hooks/useNotifications.ts` — notification management
  - `hooks/useProfile.ts` — user profile + update
  - `hooks/useSubmitSnap.ts` — snap submission mutation
  - Query key factory: `utils/queryKeys.ts`
- **Priority:** P0 | **Effort:** L | **Improves:** Architecture +20, Change Safety +10, Consistency +10

### 2.6 Type the Database Query Layer
- **File:** `blink-server/src/config/database.ts` + create `src/types/db.ts`
- **Fix:** Generic `query<T>()` + typed row interfaces (`UserRow`, `GroupRow`, `ChallengeRow`, etc.)
- **Priority:** P1 | **Effort:** M | **Improves:** Type Safety +15, Code Clarity +5

### 2.7 Route Parameter Validation
- **File:** `blink-server/src/middleware/validate.ts`
- **Problem:** Route params (`:id`, `:groupId`) go to SQL without UUID validation — leaks PG errors.
- **Fix:** Add `validateParams()` middleware with UUID Zod schema.
- **Priority:** P1 | **Effort:** S | **Improves:** Type Safety +5, Consistency +5

### 2.8 Add App-Level Error Boundary
- **File:** `blink-app/app/_layout.tsx`
- **Problem:** Only `snap-challenge.tsx` has an error boundary. Crash in any screen kills the app.
- **Fix:** Wrap `RootLayoutNav` in an `ErrorBoundary` that shows recovery UI.
- **Priority:** P1 | **Effort:** S | **Improves:** Change Safety +10

### 2.9 Add Frontend Utility Tests
- **Files:** Create `__tests__/time.test.ts`, `__tests__/notifications.test.ts`
- **Problem:** `time.ts` (6 pure functions) and `notifications.ts` (8+ branches) have zero tests.
- **Priority:** P0 | **Effort:** S | **Improves:** Test Foundation +15, Change Safety +10

### 2.10 Type All API Function Returns
- **File:** `blink-app/services/api.ts`
- **Fix:** Add return types to all API functions: `getSpotlight(): Promise<ApiSpotlight>`, `getBlockedUsers(): Promise<ApiUser[]>`, etc.
- **Priority:** P1 | **Effort:** S | **Improves:** Type Safety +8, Code Clarity +5

---

## Phase 3: Hardening (2-4 weeks)

> **Target score: ~64/100** | Depth improvements

### 3.1 Versioned Database Migrations
- **File:** `blink-server/src/config/migrate.ts` (260 lines, single SQL string)
- **Fix:** Adopt `node-pg-migrate`. Create numbered files: `001_initial_schema.sql`, `002_notifications.sql`, etc. Add migrations tracking table.
- **Priority:** P1 | **Effort:** M | **Improves:** Architecture +10, Change Safety +10

### 3.2 Eliminate `any` Types (55 server + 69 frontend = 124 total)
- **Hotspots:**
  - Server: `challenges.ts` (23), `pushNotifications.ts` (8), `challengeScheduler.ts` (6)
  - Frontend: `group-detail.tsx` (10), `(home)/index.tsx` (10), `(blinks)/index.tsx` (7), `_layout.tsx` (5)
- **Fix:** Systematic sweep. ESLint `no-explicit-any: warn` → `error`.
- **Priority:** P1 | **Effort:** L | **Improves:** Type Safety +15, Code Clarity +5

### 3.3 Integration Tests with Real PostgreSQL
- **File:** Create `blink-server/docker-compose.test.yml`, `jest.integration.config.js`
- **Fix:** Test DB container, migration runner, 10-20 integration tests for critical paths (auth, groups, challenges).
- **Priority:** P2 | **Effort:** L | **Improves:** Test Foundation +25, Change Safety +10

### 3.4 Component Smoke Tests
- **Files:** Create tests for `Button`, `ErrorState`, `GroupCard`, `SnapCard`, key screens
- **Fix:** Use `@testing-library/react-native`. Verify rendering, prop handling, user interactions.
- **Priority:** P1 | **Effort:** M | **Improves:** Test Foundation +10, Change Safety +5

### 3.5 Extract Service Layer (Backend)
- **Files:** Create `blink-server/src/services/groupService.ts`, `challengeService.ts`, `streakService.ts`, `notificationService.ts`
- **Problem:** Route handlers are fat — challenge response handler is 120 lines mixing membership verification, moderation, streak calculation, milestones, push notifications.
- **Fix:** Routes become thin controllers. Services are independently testable.
- **Priority:** P1 | **Effort:** L | **Improves:** Architecture +15, Code Clarity +10

### 3.6 ADR (Architecture Decision Records) Directory
- **Files:** Create `docs/adrs/001-no-firebase.md` through `006-in-memory-otp.md`
- **Priority:** P2 | **Effort:** S | **Improves:** Documentation +20, Architecture +5

### 3.7 Standardize Error Handling (Frontend)
- **Problem:** 32 empty `catch {}` blocks across 17 files. Mixed patterns: some `Alert.alert`, some silent, some re-throw.
- **Fix:** Convention: API errors via React Query `isError`, mutations show `Alert.alert`, never empty `catch {}`.
- **Priority:** P1 | **Effort:** M | **Improves:** Consistency +10, Code Clarity +5

### 3.8 Move OTP Store to PostgreSQL
- **File:** `blink-server/src/routes/auth.ts:19`
- **Problem:** `pendingOtps` is an in-memory Map — lost on restart, doesn't scale, never cleaned up.
- **Fix:** `otp_codes` table with TTL, or Redis.
- **Priority:** P1 | **Effort:** M | **Improves:** Architecture +5, Change Safety +5

### 3.9 Remove Dead Code
- **Frontend:** Hidden routes `(home)/` and `activity/`, no-op `completeOnboarding`, always-false `hasSubmittedToday`
- **Backend:** Empty `models/` directory
- **Priority:** P2 | **Effort:** S | **Improves:** Code Clarity +5

---

## Phase 4: Excellence (1-2 months)

> **Target score: ~80/100** | Agent-ready status

### 4.1 End-to-End Type Safety (OpenAPI Codegen)
- Generate OpenAPI spec from Zod schemas (`zod-to-openapi`), auto-generate typed client SDK.
- **Improves:** Type Safety +15, Architecture +10

### 4.2 80%+ Test Coverage
- Fill all gaps: `aiService.ts`, `contentModeration.ts`, `challengeScheduler.ts`, `socket/`, all screens, all hooks.
- E2E tests with Detox or Maestro for critical flows.
- **Improves:** Test Foundation +40, Change Safety +15

### 4.3 Full CI/CD with EAS Build Integration
- Automatic EAS builds on tags, preview builds on PRs, Railway deploy on merge, migration dry-runs.
- **Improves:** Feedback Loops +20, Change Safety +10

### 4.4 Repository/Data-Access Layer
- Create `blink-server/src/repositories/` centralizing all SQL queries.
- **Improves:** Architecture +10, Change Safety +8

### 4.5 Comprehensive .claude/ Project Context
- Custom slash commands, `settings.json`, enhanced CLAUDE.md with complete conventions.
- **Improves:** Documentation +10, Feedback Loops +5

---

## Projected Score Progression

| Dimension | Current | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|-----------|---------|---------|---------|---------|---------|
| Type Safety (20%) | 42 | 50 | 72 | 80 | 95 |
| Test Foundation (15%) | 3 | 3 | 23 | 48 | 80 |
| Documentation (15%) | 18 | 53 | 55 | 73 | 85 |
| Code Clarity (15%) | 45 | 50 | 65 | 75 | 80 |
| Architecture (15%) | 35 | 50 | 65 | 75 | 80 |
| Feedback Loops (10%) | 4 | 19 | 50 | 55 | 75 |
| Consistency (5%) | 12 | 42 | 55 | 65 | 70 |
| Change Safety (5%) | 18 | 38 | 58 | 68 | 80 |
| **Weighted Total** | **~26** | **~41** | **~55** | **~67** | **~82** |

---

## Critical P0 Items (Do First)

| # | Task | File(s) | Effort |
|---|------|---------|--------|
| 1 | Fix dev OTP fallback default | `auth.ts:16` | 15 min |
| 2 | Fix Socket.io group join auth | `socket/index.ts:35` | 30 min |
| 3 | Fix error handler message leak | `index.ts:154` | 15 min |
| 4 | Validated env config | Create `config/env.ts` | 1 hr |
| 5 | Generic `api<T>()` | `api.ts:90` | 2 hr |
| 6 | ESLint + Prettier configs | Both packages | 1 hr |
| 7 | Pre-commit hooks | Root `package.json` | 30 min |
| 8 | ARCHITECTURE.md | Root | 2 hr |
| 9 | `.npmrc` | `blink-app/` | 5 min |
| 10 | GitHub Actions CI | `.github/workflows/` | 2 hr |
| 11 | Database transactions | `database.ts` + routes | 4 hr |
| 12 | Split AppProvider | `providers/` + `hooks/` | 8 hr |
| 13 | Split group-detail.tsx | `app/` + `components/` | 8 hr |
| 14 | Frontend utility tests | `__tests__/` | 2 hr |

**Total Phase 1 + P0 Phase 2: ~32 hours of focused work**
