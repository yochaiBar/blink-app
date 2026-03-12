# Blink - Architecture Document

## 1. Project Overview

Blink is a social photo-sharing app where friend groups exchange spontaneous photo challenges. A challenge fires, everyone has seconds to snap a photo or answer a quiz, and the group reveals results together. The app layers in AI-generated challenges, streak mechanics, daily spotlights, and skip penalties to keep groups engaged.

**Target audience:** Gen-Z and young millennial friend groups (15-30) who want a more spontaneous, game-like alternative to group chats.

**Core loop:** Challenge triggers -> countdown -> snap/answer -> reveal -> react -> streaks grow

---

## 2. Tech Stack

| Layer | Technology | Role |
|-------|-----------|------|
| **Mobile App** | React Native 0.81 + Expo SDK 54 | Cross-platform iOS/Android client |
| **Routing** | expo-router 6 (file-based) | Navigation with deep link support |
| **State (client)** | Zustand 5 | Auth state, onboarding state |
| **Server cache** | React Query (TanStack) 5 | API data fetching, caching, invalidation |
| **API Server** | Express 5 (Node.js 20) | REST API, serves legal pages |
| **Database** | PostgreSQL 16 | Primary data store, all tables |
| **Real-time** | Socket.io 4 | Challenge events, group notifications |
| **Auth** | JWT (access + refresh) | Stateless auth with token revocation |
| **OTP delivery** | Twilio SMS | Phone number verification |
| **File storage** | AWS S3 (presigned URLs) | Photo uploads |
| **Content moderation** | AWS Rekognition | Image safety scanning |
| **AI** | Anthropic Claude API | Challenge generation, spotlights, commentary, penalties |
| **Push notifications** | Expo Push API | Native push via Expo's servers (no FCM) |
| **Validation** | Zod 4 | Request body and param validation |
| **Error tracking** | Sentry | Both client and server |
| **Logging** | Custom structured JSON logger | Structured JSON to stdout |
| **Deployment** | Railway (Docker) | API service + managed Postgres |
| **Scheduled jobs** | node-cron | Auto-challenge generation every 15 min |
| **Security** | Helmet, express-rate-limit, bcryptjs | HTTP hardening, rate limiting |

---

## 3. Directory Structure

```
blink/
+-- blink-app/                     # React Native / Expo client
|   +-- app/                       # expo-router file-based routing
|   |   +-- _layout.tsx            # Root layout: QueryClient, AuthGate, Sentry, notifications
|   |   +-- (tabs)/                # Bottom tab navigator
|   |   |   +-- _layout.tsx        # Tab bar config (Blinks, Groups, You)
|   |   |   +-- (blinks)/          # Blinks feed tab (challenge content feed)
|   |   |   +-- (groups)/          # Groups list tab
|   |   |   +-- profile/           # User profile tab
|   |   |   +-- (home)/            # Legacy home tab (hidden)
|   |   |   +-- activity/          # Legacy activity tab (hidden)
|   |   +-- onboarding.tsx         # Phone auth onboarding
|   |   +-- snap-challenge.tsx     # Full-screen photo capture challenge
|   |   +-- quiz-challenge.tsx     # Full-screen quiz/poll challenge
|   |   +-- challenge-reveal.tsx   # Post-challenge reveal screen
|   |   +-- challenge-history.tsx  # Past challenges in a group
|   |   +-- group-detail.tsx       # Group info, members, stats
|   |   +-- group-prompt.tsx       # Custom prompt creation
|   |   +-- group-leaderboard.tsx  # Streak leaderboard
|   |   +-- create-group.tsx       # Modal: new group form
|   |   +-- join-group.tsx         # Modal: enter invite code
|   |   +-- invite-members.tsx     # Modal: share invite link
|   |   +-- notifications.tsx      # Notification center
|   |   +-- edit-profile.tsx       # Edit display name, avatar, bio
|   |   +-- settings.tsx           # App settings
|   |   +-- share-card.tsx         # Generate shareable image card
|   |   +-- help-faq.tsx           # Help and FAQ
|   +-- components/                # Shared UI components
|   |   +-- FeedItem.tsx           # Blinks feed item
|   |   +-- GroupCard.tsx          # Group list card
|   |   +-- SnapCard.tsx           # Photo response card
|   |   +-- SpotlightCard.tsx      # Daily spotlight display
|   |   +-- StreakCelebration.tsx   # Streak milestone animation
|   |   +-- ReportModal.tsx        # Content reporting modal
|   |   +-- ShareCard.tsx          # Shareable card generator
|   |   +-- AiCommentaryCard.tsx   # AI commentary display
|   |   +-- ui/                    # Primitive UI components (OfflineBanner, etc.)
|   +-- services/
|   |   +-- api.ts                 # HTTP client, token management, auto-refresh
|   |   +-- socket.ts              # Socket.io client connection management
|   +-- stores/
|   |   +-- authStore.ts           # Zustand: auth state (user, login, logout)
|   |   +-- onboardingStore.ts     # Zustand: onboarding progress
|   +-- hooks/
|   |   +-- useSocket.ts           # Socket lifecycle + React Query invalidation
|   +-- providers/
|   |   +-- AppProvider.tsx        # App-wide context (user data)
|   +-- constants/
|   |   +-- colors.ts              # Design system theme
|   +-- types/                     # TypeScript type definitions
|   +-- utils/
|   |   +-- notifications.ts       # Push token registration, notification routing
|   +-- app.config.ts              # Expo config (API URL, bundle ID, EAS)
|   +-- app.json                   # Expo static config
|   +-- eas.json                   # EAS Build profiles
|
+-- blink-server/                  # Express API server
|   +-- src/
|   |   +-- index.ts               # Express app: middleware, routes, rate limits, graceful shutdown
|   |   +-- config/
|   |   |   +-- database.ts        # pg Pool setup, connection pooling, SSL config
|   |   |   +-- migrate.ts         # All CREATE TABLE / ALTER TABLE statements
|   |   |   +-- sms.ts             # Twilio SMS client
|   |   +-- routes/
|   |   |   +-- auth.ts            # OTP, JWT, profile, push token, account deletion
|   |   |   +-- groups.ts          # CRUD groups, join/leave, streaks
|   |   |   +-- challenges.ts      # Create/respond/reveal challenges, reactions, history
|   |   |   +-- upload.ts          # S3 presigned URL generation
|   |   |   +-- spotlight.ts       # Daily spotlight generation
|   |   |   +-- activity.ts        # Cross-group activity feed
|   |   |   +-- notifications.ts   # Notification list, mark read
|   |   |   +-- moderation.ts      # Report content, block/unblock users
|   |   +-- middleware/
|   |   |   +-- auth.ts            # JWT verification + token revocation check
|   |   |   +-- validate.ts        # Zod body validation middleware
|   |   |   +-- validateParams.ts  # UUID param validation middleware
|   |   |   +-- asyncHandler.ts    # Express async error wrapper
|   |   +-- services/
|   |   |   +-- aiService.ts       # Claude API: challenges, spotlights, penalties, commentary
|   |   |   +-- contentModeration.ts # AWS Rekognition image scanning
|   |   |   +-- pushNotifications.ts # Expo Push API client (single + batch + receipts)
|   |   +-- socket/
|   |   |   +-- index.ts           # Socket.io: auth middleware, room management, emitToGroup
|   |   +-- jobs/
|   |   |   +-- challengeScheduler.ts # Cron: auto-generate AI challenges every 15 min
|   |   +-- utils/
|   |   |   +-- constants.ts       # JWT expiry, rate limits, countdown seconds
|   |   |   +-- schemas.ts         # All Zod validation schemas
|   |   |   +-- logger.ts          # Structured JSON logger
|   |   |   +-- notifications.ts   # createNotification helper (DB insert)
|   |   +-- __tests__/             # Jest test suites
|   +-- Dockerfile                 # Multi-stage build: builder + runner
|   +-- .env.example               # Dev environment template
|   +-- .env.production.example    # Production environment template
|
+-- legal/                         # Static HTML legal pages
+-- docker-compose.yml             # Local dev: Postgres 16 + Redis 7 + backend
+-- railway.toml                   # Railway deployment config
```

---

## 4. Data Flow

A typical authenticated API request flows through these layers:

```
React Native App                        Express Server                          PostgreSQL
+------------------+                    +---------------------------+           +-----------+
|                  |  HTTP/JSON         |                           |  SQL      |           |
|  services/api.ts |  ---- req ---->   |  Rate Limiter             |           |           |
|  (Bearer JWT)    |                    |    |                      |           |           |
|                  |                    |    v                      |           |           |
|                  |                    |  Helmet + CORS            |           |           |
|                  |                    |    |                      |           |           |
|                  |                    |    v                      |           |           |
|                  |                    |  authenticate middleware  |  -------> | revoked_  |
|                  |                    |  (JWT verify + revoke     |  <------- | tokens    |
|                  |                    |   check)                  |           |           |
|                  |                    |    |                      |           |           |
|                  |                    |    v                      |           |           |
|                  |                    |  Zod validation           |           |           |
|                  |                    |  (validateBody /          |           |           |
|                  |                    |   validateParams)         |           |           |
|                  |                    |    |                      |           |           |
|                  |                    |    v                      |           |           |
|                  |                    |  Route handler            |  -------> | tables    |
|                  |  <--- res -----   |  (asyncHandler wrapped)   |  <------- |           |
|                  |                    |    |                      |           |           |
|                  |                    |    +--> Socket.io emit    |           |           |
|                  |                    |    +--> Push notification |           |           |
|                  |                    |    +--> DB notification   |           |           |
+------------------+                    +---------------------------+           +-----------+
        |
        | Socket.io (WebSocket)
        v
+------------------+
| useSocket hook   |  challenge:started -> invalidate React Query cache
| (event listener) |  challenge:response -> invalidate responses
|                  |  challenge:completed -> invalidate challenge + groups
|                  |  group:member-joined -> invalidate groups
+------------------+
```

**Key patterns:**
- The `api()` function in `services/api.ts` automatically attaches the Bearer token and retries with a refreshed token on 401.
- All route handlers are wrapped with `asyncHandler` to catch promise rejections.
- Side effects (push notifications, socket emits, DB notifications) happen fire-and-forget after the primary response.
- React Query handles client-side caching; Socket.io events trigger `invalidateQueries` for real-time updates.

---

## 5. Authentication Flow

```
    Client                          Server                          Twilio
      |                               |                               |
      |  POST /auth/request-otp       |                               |
      |  { phone_number }             |                               |
      |------------------------------>|                               |
      |                               |  Generate 6-digit OTP         |
      |                               |  Store in-memory (Map)        |
      |                               |  5-minute expiry              |
      |                               |------------------------------>|
      |                               |  sendSms(phone, code)         |
      |  { message: "OTP sent" }      |<------------------------------|
      |<------------------------------|                               |
      |                               |                               |
      |  POST /auth/verify-otp        |                               |
      |  { phone_number, code }       |                               |
      |------------------------------>|                               |
      |                               |  Timing-safe compare          |
      |                               |  Max 5 attempts per code      |
      |                               |  UPSERT user record           |
      |                               |  Sign JWT access (15m)        |
      |                               |  Sign JWT refresh (7d)        |
      |  { user, accessToken,         |                               |
      |    refreshToken }             |                               |
      |<------------------------------|                               |
      |                               |                               |
      |  Store accessToken in         |                               |
      |  SecureStore (native) or      |                               |
      |  localStorage (web)           |                               |
      |                               |                               |
      |  --- Later: token expired --- |                               |
      |                               |                               |
      |  Any API call returns 401     |                               |
      |------------------------------>|                               |
      |                               |                               |
      |  POST /auth/refresh           |                               |
      |  { refreshToken }             |                               |
      |------------------------------>|                               |
      |                               |  Verify refresh token         |
      |                               |  Sign new access token (15m)  |
      |  { accessToken }              |                               |
      |<------------------------------|                               |
```

**Token revocation:** On account deletion, a row is inserted into `revoked_tokens`. The `authenticate` middleware checks this table on every request. All tokens for that user become invalid immediately.

**Dev mode:** When Twilio env vars are not configured, the server accepts `123456` as a valid OTP for any phone number.

---

## 6. Real-time Events (Socket.io)

### Connection

The client connects via WebSocket with JWT authentication:

```typescript
// Client
io(SERVER_URL, { auth: { token: accessToken }, transports: ['websocket'] });

// Server middleware verifies JWT before allowing connection
```

### Room Management

After connecting, the client emits `join-groups` with an array of group IDs. The server verifies membership against the database before joining the socket to `group:{id}` rooms.

### Events

| Event | Direction | Payload | Trigger |
|-------|-----------|---------|---------|
| `join-groups` | Client -> Server | `string[]` (group IDs) | After connect, on reconnect |
| `challenge:started` | Server -> Group | `{ challenge: { id, group_id, type, prompt, expires_at, triggered_by_name } }` | New challenge created |
| `challenge:response` | Server -> Group | `{ challengeId, response: { id, challenge_id, user_id, photo_url } }` | Member submits response |
| `challenge:completed` | Server -> Group | `{ challengeId, groupId, ai_commentary? }` | All members responded or challenge expired |
| `group:member-joined` | Server -> Group | `{ groupId, userId, displayName }` | New member joins via invite code |

All server-to-client events target a specific group room via `emitToGroup(groupId, event, data)`.

On the client, `useSocket` hook maps these events to React Query cache invalidations so the UI updates instantly without polling.

---

## 7. File Upload Flow

```
Client                          Server                      AWS S3              AWS Rekognition
  |                               |                           |                      |
  |  POST /upload/presign         |                           |                      |
  |  { groupId, challengeId }     |                           |                      |
  |------------------------------>|                           |                      |
  |                               |  Generate S3 key:         |                      |
  |                               |  groups/{gid}/{cid}/{uuid}/original.jpg          |
  |                               |  Create PutObjectCommand  |                      |
  |                               |  Sign URL (300s expiry)   |                      |
  |  { uploadUrl, publicUrl }     |                           |                      |
  |<------------------------------|                           |                      |
  |                               |                           |                      |
  |  PUT uploadUrl                |                           |                      |
  |  (binary JPEG body)          |                           |                      |
  |---------------------------------------------->|           |                      |
  |                               |               |  Stored   |                      |
  |  200 OK                       |               |           |                      |
  |<----------------------------------------------|           |                      |
  |                               |                           |                      |
  |  POST /challenges/:id/respond |                           |                      |
  |  { photo_url: publicUrl }     |                           |                      |
  |------------------------------>|                           |                      |
  |                               |  extractS3Key(photo_url)  |                      |
  |                               |  moderateImage(s3Key)     |--------------------->|
  |                               |                           |  DetectModeration    |
  |                               |                           |  Labels              |
  |                               |  Result: safe/unsafe      |<---------------------|
  |                               |                           |                      |
  |                               |  If unsafe:               |                      |
  |                               |    deleteS3Object()       |                      |
  |                               |    return 400             |                      |
  |                               |  If safe:                 |                      |
  |                               |    INSERT response        |                      |
  |                               |    logModerationResult()  |                      |
  |  { response }                 |                           |                      |
  |<------------------------------|                           |                      |
```

**Dev mode fallback:** When AWS env vars are not set, the presign endpoint returns `{ uploadUrl: null, dev_mode: true }`. The client falls back to passing the image URI directly (base64 data URI or local file path).

**Content moderation:** Controlled by `CONTENT_MODERATION_ENABLED=true`. When enabled, images are scanned against blocked categories (nudity, violence, drugs, hate symbols, etc.) with a configurable confidence threshold (default 75%). Fails closed when Rekognition is unavailable.

---

## 8. Database Schema

### Entity-Relationship Overview

```
users 1--* group_members *--1 groups
users 1--* challenge_responses *--1 challenges *--1 groups
users 1--* notifications
users 1--* reactions *--1 challenge_responses
users 1--* content_reports
users 1--* user_blocks
users 1--* streak_shields *--1 groups
users 1--* streak_milestones *--1 groups
groups 1--* daily_spotlights
groups 1--* active_penalties
groups 1--1 challenge_schedule
groups 1--* ai_generation_log
users 1--* otp_requests
users 1--* revoked_tokens
users 1--* content_moderation_log
```

### Tables

#### `users`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | `gen_random_uuid()` |
| phone_number | VARCHAR(20) UNIQUE | E.164 format |
| display_name | VARCHAR(50) | Nullable |
| avatar_url | TEXT | S3 URL, nullable |
| bio | TEXT | Nullable, max 200 chars (app-enforced) |
| push_token | TEXT | Expo push token, nullable |
| created_at | TIMESTAMP | Default NOW() |
| last_active_at | TIMESTAMP | Updated on login |

#### `groups`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| name | VARCHAR(100) | |
| icon | VARCHAR(10) | Emoji, default '👥' |
| category | VARCHAR(20) | CHECK: friends, family, students, work, custom |
| created_by | UUID FK -> users | |
| invite_code | VARCHAR(12) UNIQUE | 12-char hex, uppercase |
| max_members | INT | Default 15 |
| quiet_hours_start | TIME | Default 22:00 |
| quiet_hours_end | TIME | Default 08:00 |
| skip_penalty_type | VARCHAR(20) | CHECK: wanted_poster, avatar_change, servant, none |
| ai_personality | VARCHAR(30) | CHECK: family_friendly, funny, spicy, sarcastic, motivational, extreme, sexy, no_filter |
| group_streak | INT | Default 0 |
| longest_group_streak | INT | Default 0 |
| created_at | TIMESTAMP | |

#### `group_members`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| group_id | UUID FK -> groups | CASCADE delete |
| user_id | UUID FK -> users | CASCADE delete |
| role | VARCHAR(10) | CHECK: admin, member |
| joined_at | TIMESTAMP | |
| current_streak | INT | Default 0 |
| total_responses | INT | Default 0 |
| total_challenges | INT | Default 0 |
| UNIQUE | (group_id, user_id) | |

#### `challenges`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| group_id | UUID FK -> groups | CASCADE delete |
| type | VARCHAR(20) | CHECK: snap, quiz, poll, blink_test, prompt |
| prompt_text | TEXT | Challenge question/prompt |
| options_json | JSONB | Quiz/poll answer options |
| triggered_by | UUID FK -> users | NULL for auto-generated |
| triggered_at | TIMESTAMP | Default NOW() |
| expires_at | TIMESTAMP | NOT NULL |
| countdown_seconds | INT | Default 10 |
| status | VARCHAR(20) | CHECK: active, completed, expired |
| is_auto_generated | BOOLEAN | Default false |
| ai_generated_prompt | TEXT | Original AI prompt text |
| ai_commentary | TEXT | AI comment on results |

#### `challenge_responses`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| challenge_id | UUID FK -> challenges | CASCADE delete |
| user_id | UUID FK -> users | |
| response_type | VARCHAR(10) | CHECK: photo, answer, skip |
| photo_url | TEXT | S3 URL or base64 data URI |
| answer_index | INT | For quiz responses |
| answer_text | TEXT | For prompt responses |
| responded_at | TIMESTAMP | |
| response_time_ms | INT | Milliseconds to respond |
| UNIQUE | (challenge_id, user_id) | One response per user per challenge |

#### `reactions`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| response_id | UUID FK -> challenge_responses | CASCADE delete |
| user_id | UUID FK -> users | CASCADE delete |
| emoji | VARCHAR(10) | |
| created_at | TIMESTAMP | |
| UNIQUE | (response_id, user_id, emoji) | One of each emoji per user |

#### `notifications`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| user_id | UUID FK -> users | CASCADE delete |
| type | VARCHAR(30) | challenge_started, snap_received, group_joined, streak_milestone, spotlight |
| title | TEXT | |
| body | TEXT | |
| group_id | UUID FK -> groups | Nullable, CASCADE delete |
| from_user_id | UUID FK -> users | Nullable, SET NULL on delete |
| read | BOOLEAN | Default false |
| created_at | TIMESTAMP | |

#### `daily_spotlights`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| group_id | UUID FK -> groups | |
| featured_user_id | UUID FK -> users | |
| superlative | TEXT | AI-generated or fallback |
| stats_json | JSONB | streak, total_responses, participation_rate, fun_fact |
| date | DATE | Default CURRENT_DATE |
| UNIQUE | (group_id, date) | One spotlight per group per day |

#### `active_penalties`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| group_id | UUID FK -> groups | |
| user_id | UUID FK -> users | |
| penalty_type | VARCHAR(20) | wanted_poster, avatar_change, servant |
| penalty_data | JSONB | AI-generated penalty text |
| expires_at | TIMESTAMP | |
| created_at | TIMESTAMP | |

#### `streak_shields`
Earned at milestones (7, 14, 30 day streaks). Protects a user's streak if they miss one challenge.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| user_id | UUID FK -> users | |
| group_id | UUID FK -> groups | |
| earned_at | TIMESTAMP | |
| used_at | TIMESTAMP | Nullable |
| used_for_challenge_id | UUID FK -> challenges | Nullable |

#### `streak_milestones`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| user_id, group_id | UUID FKs | |
| milestone | INT | 3, 7, 14, 30, etc. |
| reached_at | TIMESTAMP | |
| UNIQUE | (user_id, group_id, milestone) | |

#### `content_reports`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| reporter_id | UUID FK -> users | |
| reported_user_id | UUID FK -> users | Nullable |
| reported_content_id | UUID | Generic reference |
| content_type | VARCHAR(20) | photo, user, group, challenge_response |
| reason | VARCHAR(50) | inappropriate, spam, harassment, hate_speech, nudity, violence, other |
| status | VARCHAR(20) | pending, reviewed, resolved, dismissed |

#### `user_blocks`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| blocker_id, blocked_id | UUID FKs -> users | |
| UNIQUE | (blocker_id, blocked_id) | |

#### `otp_requests`
Persistent OTP audit trail (in addition to the in-memory Map used for active verification).

#### `revoked_tokens`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID PK | |
| user_id | UUID | |
| revoked_at | TIMESTAMP | |

The `authenticate` middleware checks this table on every request to enforce immediate token invalidation after account deletion.

#### `content_moderation_log`
Stores AWS Rekognition results for all moderated images (safe and flagged).

#### `challenge_schedule`
| Column | Type | Notes |
|--------|------|-------|
| group_id | UUID UNIQUE FK -> groups | |
| last_auto_challenge_at | TIMESTAMP | |

#### `ai_generation_log`
Tracks every Claude API call for cost monitoring and debugging.

| Column | Type | Notes |
|--------|------|-------|
| group_id | UUID FK -> groups | |
| function_name | VARCHAR(50) | generateChallenge, generateSpotlightSuperlative, etc. |
| personality | VARCHAR(30) | |
| tokens_used | INT | |
| latency_ms | INT | |
| fallback_used | BOOLEAN | True when AI failed and hardcoded fallback was used |

### Indexes

All indexes use `IF NOT EXISTS` for idempotent migrations:

- `idx_group_members_user` on group_members(user_id)
- `idx_group_members_group` on group_members(group_id)
- `idx_challenges_group` on challenges(group_id)
- `idx_challenges_status` on challenges(status)
- `idx_challenge_responses_challenge` on challenge_responses(challenge_id)
- `idx_groups_invite_code` on groups(invite_code)
- `idx_daily_spotlights_group_date` on daily_spotlights(group_id, date)
- `idx_active_penalties_user` on active_penalties(user_id, group_id)
- `idx_notifications_user` on notifications(user_id, created_at DESC)
- `idx_reactions_response` on reactions(response_id)
- `idx_content_reports_reporter` on content_reports(reporter_id)
- `idx_content_reports_reported_user` on content_reports(reported_user_id)
- `idx_user_blocks_blocker` on user_blocks(blocker_id)
- `idx_user_blocks_blocked` on user_blocks(blocked_id)
- `idx_otp_requests_phone` on otp_requests(phone_number)
- `idx_revoked_tokens_user` on revoked_tokens(user_id)
- `idx_content_moderation_log_user` on content_moderation_log(user_id)
- `idx_content_moderation_log_safe` on content_moderation_log(safe)
- `idx_streak_shields_user_group` on streak_shields(user_id, group_id)
- `idx_streak_milestones_user_group` on streak_milestones(user_id, group_id)
- `idx_challenge_schedule_group` on challenge_schedule(group_id)
- `idx_ai_gen_log_group` on ai_generation_log(group_id)

---

## 9. API Routes

All routes are prefixed with `/api`. Routes marked "Auth" require a `Bearer` JWT in the `Authorization` header.

### Auth (`/api/auth`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/request-otp` | No | Send OTP to phone number via Twilio |
| POST | `/auth/verify-otp` | No | Verify OTP, upsert user, return JWT tokens |
| POST | `/auth/refresh` | No | Exchange refresh token for new access token |
| GET | `/auth/me` | Yes | Get current user profile |
| GET | `/auth/stats` | Yes | Get user stats (total snaps, longest streak, group count) |
| PATCH | `/auth/profile` | Yes | Update display_name, avatar_url, or bio |
| POST | `/auth/push-token` | Yes | Register Expo push notification token |
| DELETE | `/auth/delete-account` | Yes | Delete account, revoke all tokens |

### Groups (`/api/groups`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/groups` | Yes | Create a group (max 3 free tier) |
| GET | `/groups` | Yes | List user's groups with active challenge info |
| GET | `/groups/:id` | Yes | Get group details, members, stats, active penalties |
| POST | `/groups/join` | Yes | Join a group via invite code |
| POST | `/groups/:id/leave` | Yes | Leave a group (auto-transfers admin if needed) |
| DELETE | `/groups/:id` | Yes | Delete a group (admin only) |
| GET | `/groups/:id/streaks` | Yes | Get group streak, member streaks, shields, milestones |

### Challenges (`/api/challenges`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/challenges/pending` | Yes | Get all pending challenges across user's groups |
| POST | `/challenges/groups/:groupId/challenges` | Yes | Create a new challenge in a group |
| GET | `/challenges/groups/:groupId/challenges/active` | Yes | Get active challenge for a group |
| POST | `/challenges/:id/respond` | Yes | Submit photo/answer/skip response |
| GET | `/challenges/:id/responses` | Yes | Get all responses for a challenge |
| GET | `/challenges/:id/reveal` | Yes | Get reveal data (responses + stats + AI commentary) |
| GET | `/challenges/:id/progress` | Yes | Get response progress (who responded, who is pending) |
| GET | `/challenges/:id/preview` | Yes | Get blurred/teaser preview before reveal |
| GET | `/challenges/groups/:groupId/challenges/history` | Yes | Get past challenges for a group (paginated) |
| GET | `/challenges/groups/:groupId/photos` | Yes | Get photo gallery for a group |
| POST | `/challenges/responses/:responseId/reactions` | Yes | Add emoji reaction to a response |
| DELETE | `/challenges/responses/:responseId/reactions/:emoji` | Yes | Remove a reaction |

### Upload (`/api/upload`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/upload/presign` | Yes | Get presigned S3 upload URL |

### Spotlight (`/api/spotlight`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/spotlight/:groupId` | Yes | Get or generate today's daily spotlight |

### Activity (`/api/activity`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/activity` | Yes | Recent activity across all user's groups (cursor-based pagination via `?before=`) |

### Notifications (`/api/notifications`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/notifications` | Yes | Get user's notifications (last 50) |
| PATCH | `/notifications/read` | Yes | Mark all notifications as read |
| PATCH | `/notifications/:id/read` | Yes | Mark single notification as read |

### Moderation (`/api/moderation`)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/moderation/report` | Yes | Report content or user |
| POST | `/moderation/block` | Yes | Block a user |
| GET | `/moderation/blocks` | Yes | List blocked users |
| DELETE | `/moderation/blocks/:userId` | Yes | Unblock a user |

### Other

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | Health check (server + database) |
| GET | `/privacy` | No | Privacy policy HTML page |
| GET | `/terms` | No | Terms of service HTML page |
| GET | `/legal/privacy` | No | Redirect to /privacy |
| GET | `/legal/terms` | No | Redirect to /terms |

### Rate Limits

| Scope | Window | Max Requests |
|-------|--------|-------------|
| Global | 1 minute | 100 |
| OTP request | 1 hour | 3 (configurable via `OTP_RATE_LIMIT_PER_HOUR`) |
| OTP verify | 15 minutes | 5 |
| Photo upload | 1 minute | 10 |
| Group creation | 24 hours | 5 |
| Group join | 1 hour | 20 |

---

## 10. Key Design Decisions

### Why Zustand over Redux

Zustand provides a minimal API with no boilerplate (no action types, reducers, or dispatch). The app has only two stores (`authStore`, `onboardingStore`) with simple state shapes. Redux's overhead is not justified for this scale. Zustand also integrates naturally with React's concurrent features and has a smaller bundle size.

### Why React Query alongside Zustand

Zustand manages client-only state (auth session, onboarding progress). React Query manages server state (groups, challenges, activity feeds) with built-in caching, background refetching, and stale-while-revalidate. This separation keeps concerns clean: Zustand never holds API data, React Query never holds UI state.

### Why no ORM (raw SQL with pg)

The app uses parameterized SQL queries through the `pg` driver directly. This was chosen for:
- **Transparency:** Every query is visible and optimizable. No hidden N+1 problems.
- **Performance:** No ORM overhead, no query builder translation layer.
- **Migration simplicity:** A single `migrate.ts` file with raw DDL, run on every deploy. No migration framework to manage.
- **Flexibility:** Complex queries (UNION ALL activity feed, window functions for streaks) are natural in raw SQL but awkward in ORMs.

The tradeoff is more verbose code and manual type mapping, which is acceptable at this project's scale.

### Why server-side OTP (not Firebase Auth)

Firebase Auth was removed from the project entirely. Server-side OTP via Twilio was chosen because:
- **No Firebase dependency:** Eliminates the Firebase SDK from both client and server, reducing bundle size and complexity.
- **Full control:** Rate limiting, OTP expiry, attempt counting, and audit logging are all custom and tunable.
- **Simpler deployment:** No Firebase project configuration, no service account management.
- **Dev mode:** When Twilio is not configured, a predictable OTP (123456) is accepted, enabling development without any external services.

### Why Expo Push Notifications over FCM/APNs

Expo Push is a proxy service that handles FCM (Android) and APNs (iOS) behind a unified API. This was chosen because:
- **No native configuration:** No `google-services.json`, no APNs certificates to manage.
- **Unified API:** One HTTP call sends to both platforms. The Expo Push SDK handles token format differences.
- **Receipt tracking:** Expo provides receipt IDs for delivery confirmation and automatic token cleanup for unregistered devices.
- **Consistency:** Since the app already uses Expo for everything else, using Expo Push keeps the toolchain unified.

### Why in-memory OTP storage

OTP codes are stored in a Node.js `Map` rather than the database. This is intentional:
- OTPs are ephemeral (5-minute expiry) and should not persist across server restarts.
- The server runs as a single instance on Railway, so there is no multi-instance consistency problem.
- If the server restarts, users simply request a new OTP. This is expected behavior.
- The `otp_requests` table exists for audit logging, not for active verification.

### Why AI with hardcoded fallbacks

Every AI function (challenge generation, spotlight superlatives, skip penalties, commentary) has a hardcoded fallback pool. If the Claude API is unavailable, rate-limited, or returns unparseable JSON, the app seamlessly falls back to pre-written content. Users never see an error; the experience degrades gracefully from "AI-personalized" to "randomly selected from a curated pool."

---

## 11. Environment Variables

### Server (`blink-server/.env`)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `JWT_SECRET` | Yes | - | Secret for signing access tokens |
| `JWT_REFRESH_SECRET` | Yes | - | Secret for signing refresh tokens |
| `PORT` | No | 3000 | Server port |
| `NODE_ENV` | No | development | `development` or `production` |
| `CORS_ORIGINS` | Prod only | localhost:8081,19006 | Comma-separated allowed origins. **Required in production.** |
| `TWILIO_ACCOUNT_SID` | Prod | - | Twilio account SID |
| `TWILIO_AUTH_TOKEN` | Prod | - | Twilio auth token |
| `TWILIO_PHONE_NUMBER` | Prod | - | Twilio sender phone number |
| `ALLOW_DEV_OTP_FALLBACK` | No | - | Set to `true` to fall back to dev OTP when Twilio fails |
| `AWS_ACCESS_KEY_ID` | No | - | AWS IAM key for S3 + Rekognition |
| `AWS_SECRET_ACCESS_KEY` | No | - | AWS IAM secret |
| `AWS_REGION` | No | - | AWS region (us-east-1) |
| `AWS_S3_BUCKET` | No | - | S3 bucket name (blinks3upload) |
| `CONTENT_MODERATION_ENABLED` | No | false | Enable AWS Rekognition image scanning |
| `MODERATION_CONFIDENCE_THRESHOLD` | No | 75 | Rekognition confidence threshold (0-100) |
| `ANTHROPIC_API_KEY` | No | - | Claude API key for AI features |
| `AI_ENABLED` | No | false | Master switch for AI features |
| `AI_MODEL` | No | claude-sonnet-4-20250514 | Claude model to use |
| `AI_MAX_TOKENS` | No | 300 | Max tokens per AI response |
| `CHALLENGE_SCHEDULER_ENABLED` | No | false | Enable auto-challenge cron job |
| `SENTRY_DSN` | No | - | Sentry error tracking DSN |
| `EXPO_ACCESS_TOKEN` | No | - | Expo push API authentication token |
| `OTP_RATE_LIMIT_PER_HOUR` | No | 3 | OTP requests per phone per hour |
| `DB_POOL_MAX` | No | 20 | Max database connections |
| `DB_SSL_REJECT_UNAUTHORIZED` | No | true | Set to `false` for self-signed certs |
| `DB_SSL_CERT` | No | - | CA certificate for SSL |

### Client (`blink-app`)

Client environment is configured via `app.config.ts` and Expo's `extra` field:

| Variable | Set via | Description |
|----------|---------|-------------|
| `EXPO_PUBLIC_API_URL` | EAS env / app.config.ts | API base URL (overrides default resolution) |
| `EXPO_PUBLIC_SENTRY_DSN` | EAS env | Sentry DSN for client error tracking |

The API URL resolution order in `services/api.ts`:
1. `Constants.expoConfig.extra.apiUrl` (from app.config.ts, set via EAS env vars)
2. Dev fallback: `http://localhost:3000/api` (web) or production URL (native, for convenience)
3. Production: `https://blink-api-production.up.railway.app/api`

---

## 12. Development Setup

### Prerequisites

- Node.js 20+
- PostgreSQL 16 (or use Docker Compose)
- Expo CLI (`npx expo`)
- iOS Simulator (macOS) or Android Emulator
- Expo Go app on a physical device (optional)

### 1. Clone and install

```bash
git clone <repo-url> && cd blink

# Install server dependencies
cd blink-server
npm install --registry https://registry.npmjs.org

# Install app dependencies
cd ../blink-app
npm install --legacy-peer-deps --registry https://registry.npmjs.org
```

The `--legacy-peer-deps` flag is needed due to a peer dependency conflict with `lucide-react-native`. The `--registry` flag overrides any stale CodeArtifact config in `~/.npmrc`.

### 2. Start the database

**Option A: Docker Compose** (recommended)

```bash
# From project root
docker compose up -d postgres
```

This starts PostgreSQL 16 on port 5432 with database `blink_dev`, user `blink`, password `blink_dev_password`.

**Option B: Local PostgreSQL**

```bash
createdb blink_dev
```

### 3. Configure the server

```bash
cd blink-server
cp .env.example .env
```

Edit `.env` and set at minimum:

```
DATABASE_URL=postgresql://blink:blink_dev_password@localhost:5432/blink_dev
JWT_SECRET=any-random-string-for-dev
JWT_REFRESH_SECRET=another-random-string-for-dev
```

All other variables are optional for local development. Without Twilio, OTP code is `123456`. Without AWS, photos stay as local URIs.

### 4. Run migrations and start the server

```bash
cd blink-server
npm run migrate   # Creates all tables
npm run dev       # Starts with nodemon + ts-node on port 3000
```

### 5. Start the app

```bash
cd blink-app
npx expo start
```

Press `i` for iOS Simulator, `a` for Android Emulator, or scan the QR code with Expo Go.

### 6. Run tests

```bash
# Server tests (180 tests)
cd blink-server && npm test

# App tests (74 tests)
cd blink-app && npm test
```

### 7. Linting and type checking

```bash
# Server
cd blink-server && npm run lint && npm run typecheck

# App
cd blink-app && npm run lint && npm run typecheck
```

### Production deployment

The server deploys to Railway via Dockerfile. On every deploy:
1. Multi-stage Docker build compiles TypeScript
2. `CMD` runs migrations (`node dist/config/migrate.js`) then starts the server
3. Health check endpoint `/api/health` verifies server + database connectivity

```bash
# Deploy to Railway
cd blink-server && railway up --service blink-api --detach
```
