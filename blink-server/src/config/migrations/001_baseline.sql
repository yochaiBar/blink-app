-- 001_baseline: the whole Blink schema in one file.
--
-- Squashes the old 001–016 migrations (2026-11-03, recovery plan Stage 1)
-- into the end state, minus everything the recovery plan removed: AI,
-- spotlight, skip penalties, streak shields/milestones, quiz/prompt
-- challenges, server-side photo URLs, avatars, the legacy OTP table and
-- revoked_tokens (replaced by auth_sessions in Stage 2a).
--
-- Editable in place until the Stage 5 deploy; frozen after that, and later
-- changes go in 002_*.sql and up. A database migrated by the old files
-- fails loudly at boot (migrationRunner refuses unknown schema_migrations
-- rows) — point DATABASE_URL at a fresh database instead.
--
-- Every foreign key to users states its ON DELETE so that deleting an
-- account never trips a constraint: personal rows CASCADE, shared rows
-- (a group, a challenge) keep existing with the reference SET NULL.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Accounts ─────────────────────────────────────────────────────

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number VARCHAR(20) UNIQUE NOT NULL,
  display_name VARCHAR(50),
  bio TEXT,
  push_token TEXT,
  push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  last_active_at TIMESTAMP DEFAULT NOW()
);

-- One live login code per phone, stored only as HMAC(OTP_PEPPER, phone:code).
CREATE TABLE otp_codes (
  phone VARCHAR(20) PRIMARY KEY,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_otp_codes_expires ON otp_codes(expires_at);

-- One row per signed-in device. Access JWTs carry the session id and are
-- re-checked against this table, so revoking a row signs that device out
-- immediately. The refresh token is opaque (<id>.<secret>); only SHA-256 of
-- the current and previous secret is kept (the previous one for the
-- 30-second rotation grace window). Rows go with the user on deletion.
CREATE TABLE auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_hash TEXT NOT NULL,
  prev_refresh_hash TEXT,
  rotated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);

-- Device X25519 public keys for the E2E photo flow. The private key never
-- leaves the device. `attestation` = HMAC-SHA256(JWT sub, public key) binds
-- the key to the identity that registered it. Old keys are tombstoned, not
-- deleted, so the audit trail survives a reinstall.
CREATE TABLE device_public_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id UUID NOT NULL,
  x25519_public_key TEXT NOT NULL CHECK (char_length(x25519_public_key) = 44), -- base64(32 bytes)
  attestation TEXT NOT NULL CHECK (char_length(attestation) = 44),             -- base64(HMAC-SHA256)
  key_version INTEGER NOT NULL DEFAULT 1,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tombstoned_at TIMESTAMPTZ,
  UNIQUE (user_id, device_id)
);
CREATE INDEX idx_device_public_keys_active_user
  ON device_public_keys(user_id, last_seen DESC)
  WHERE tombstoned_at IS NULL;
CREATE INDEX idx_device_public_keys_tombstoned
  ON device_public_keys(tombstoned_at)
  WHERE tombstoned_at IS NOT NULL;

-- ── Groups ───────────────────────────────────────────────────────

CREATE TABLE groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  icon VARCHAR(10) DEFAULT '👥',
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  invite_code VARCHAR(12) UNIQUE NOT NULL,
  max_members INT DEFAULT 15,
  quiet_hours_start TIME DEFAULT '22:00',
  quiet_hours_end TIME DEFAULT '08:00',
  group_streak INT DEFAULT 0,
  longest_group_streak INT DEFAULT 0,
  -- Monotonic group-key version. The server never sees the key itself; the
  -- counter lets clients resolve rotations (POST /api/keyshare/reset), and
  -- photos and keyshares must be made under it.
  group_key_version INTEGER NOT NULL DEFAULT 1,
  -- Daily auto-challenge: day hours are read in this IANA zone, and the
  -- next run is claimed from next_auto_challenge_at (jobs/dailyChallenge.ts).
  timezone TEXT NOT NULL DEFAULT 'UTC',
  next_auto_challenge_at TIMESTAMPTZ,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_groups_next_auto_challenge ON groups(next_auto_challenge_at);

CREATE TABLE group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(10) DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at TIMESTAMP DEFAULT NOW(),
  current_streak INT DEFAULT 0,
  total_responses INT DEFAULT 0,
  total_challenges INT DEFAULT 0,
  -- The group-key version this member's device says it holds (POST
  -- /api/keyshare/confirm); NULL until then. Only holders of the group's
  -- current version are asked to courier the key.
  key_version INTEGER,
  UNIQUE (group_id, user_id)
);
CREATE INDEX idx_group_members_user ON group_members(user_id);
CREATE INDEX idx_group_members_group ON group_members(group_id);

-- Group-key courier handshake: one row per (group, joiner) still waiting
-- for the key on `joiner_device_id`. While the joiner's device and a holder
-- of the current key version are online, the row is claimed for that
-- courier with a short lease; the courier encrypts the key to the device
-- client-side and delivers the opaque envelope via /api/keyshare/deliver.
-- The row is deleted when the joiner confirms it holds the key, when the
-- joiner leaves, or after 7 days.
CREATE TABLE pending_joins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  joiner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joiner_device_id UUID NOT NULL,
  courier_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  lease_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (group_id, joiner_user_id)
);
CREATE INDEX idx_pending_joins_joiner ON pending_joins(joiner_user_id);
CREATE INDEX idx_pending_joins_courier ON pending_joins(courier_user_id) WHERE courier_user_id IS NOT NULL;
CREATE INDEX idx_pending_joins_created ON pending_joins(created_at);

-- ── Challenges ───────────────────────────────────────────────────

CREATE TABLE challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  prompt TEXT,
  -- NULL for scheduler-created challenges and after the creator deletes their account.
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP NOT NULL,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'expired')),
  is_auto_generated BOOLEAN NOT NULL DEFAULT FALSE,
  reminder_sent_at TIMESTAMPTZ
);
CREATE INDEX idx_challenges_group ON challenges(group_id, created_at DESC);
-- At most one active challenge per group; creating one finalizes the old.
CREATE UNIQUE INDEX uniq_challenges_one_active_per_group ON challenges(group_id) WHERE status = 'active';
-- The expiry/reminder job scans active challenges by deadline.
CREATE INDEX idx_challenges_active_expiry ON challenges(expires_at) WHERE status = 'active';

-- One row per member who responded; a member with no row skipped. The photo
-- itself never reaches the server: it goes peer-to-peer via /api/photos/relay
-- and `has_photo` only records that one exists.
CREATE TABLE challenge_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  has_photo BOOLEAN NOT NULL DEFAULT FALSE,
  responded_at TIMESTAMP DEFAULT NOW(),
  response_time_ms INT,
  UNIQUE (challenge_id, user_id)
);
CREATE INDEX idx_challenge_responses_challenge ON challenge_responses(challenge_id);

CREATE TABLE reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id UUID NOT NULL REFERENCES challenge_responses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji VARCHAR(10) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (response_id, user_id, emoji)
);
CREATE INDEX idx_reactions_response ON reactions(response_id);

-- Photo comments, threaded one level deep.
CREATE TABLE response_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id UUID NOT NULL REFERENCES challenge_responses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_comment_id UUID REFERENCES response_comments(id) ON DELETE CASCADE,
  text TEXT NOT NULL CHECK (char_length(text) BETWEEN 1 AND 280),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX idx_response_comments_response
  ON response_comments(response_id, created_at)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_response_comments_parent
  ON response_comments(parent_comment_id)
  WHERE parent_comment_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_response_comments_user ON response_comments(user_id);

-- Photo pickups owed to recipients who couldn't take a photo at relay time
-- (offline, or no key yet): pure metadata ("X is owed response Y from
-- sender Z's device"), never bytes. One row per (response, recipient); the
-- row is deleted as soon as the photo is delivered.
--
-- While both parties are online the server claims a row by setting a short
-- lease and asks the sender's device to re-encrypt and re-relay. An
-- unanswered lease simply expires and the row is offered again on the next
-- connect. Rows older than 7 days are reaped.
CREATE TABLE pending_photo_pickups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id UUID NOT NULL REFERENCES challenge_responses(id) ON DELETE CASCADE,
  challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_device_id UUID NOT NULL,
  lease_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (response_id, recipient_user_id)
);
CREATE INDEX idx_pending_pickups_recipient ON pending_photo_pickups(recipient_user_id);
CREATE INDEX idx_pending_pickups_sender ON pending_photo_pickups(sender_user_id);
CREATE INDEX idx_pending_pickups_group ON pending_photo_pickups(group_id);
CREATE INDEX idx_pending_pickups_created ON pending_photo_pickups(created_at);

-- ── Notifications and safety ─────────────────────────────────────

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(30) NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
  from_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  read BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_notifications_user ON notifications(user_id, created_at DESC);

CREATE TABLE user_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (blocker_id, blocked_id)
);
CREATE INDEX idx_user_blocks_blocker ON user_blocks(blocker_id);
CREATE INDEX idx_user_blocks_blocked ON user_blocks(blocked_id);

CREATE TABLE content_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reported_content_id UUID,
  content_type VARCHAR(20) NOT NULL CHECK (content_type IN ('photo', 'user', 'group', 'challenge_response')),
  reason VARCHAR(50) NOT NULL
    CHECK (reason IN ('inappropriate', 'spam', 'harassment', 'hate_speech', 'nudity', 'violence', 'other')),
  description TEXT,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'dismissed')),
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_content_reports_reporter ON content_reports(reporter_id);
CREATE INDEX idx_content_reports_reported_user ON content_reports(reported_user_id);

-- ── Views and helpers ────────────────────────────────────────────

-- What other users may see about a user. Phone numbers stay private: code
-- outside auth reads names from here (lint forbids phone_number elsewhere).
CREATE VIEW public_users AS
SELECT id, COALESCE(display_name, 'New member') AS display_name, bio, created_at, last_active_at
  FROM users;

-- Either user blocked the other.
CREATE FUNCTION blocked_between(a UUID, b UUID) RETURNS BOOLEAN
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_blocks
     WHERE (blocker_id = a AND blocked_id = b) OR (blocker_id = b AND blocked_id = a)
  )
$$;

-- The members of group g who may see or be told about what `actor` does
-- there: everyone else in the group, minus anyone blocked with the actor.
CREATE FUNCTION audience(g UUID, actor UUID) RETURNS TABLE (user_id UUID)
LANGUAGE sql STABLE AS $$
  SELECT gm.user_id
    FROM group_members gm
   WHERE gm.group_id = g AND gm.user_id <> actor AND NOT blocked_between(gm.user_id, actor)
$$;
