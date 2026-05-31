-- Pending photo pickups for the E2E flow (Phase 3 of the
-- "no server photo storage" plan).
--
-- The server never stores photo bytes. This table tracks pure metadata:
-- "user X is owed a photo from response Y by sender Z." When recipient X
-- next connects, the server emits a `photo:pickup_request` to Z's online
-- devices; Z re-encrypts the locally-cached plaintext and re-uploads via
-- POST /api/photos/relay targeting just X. Bytes never sit on the server.
--
-- Lifecycle (state machine, enforced application-side):
--   pending     ← row inserted when relay couldn't deliver in real time
--   in_flight   ← server has emitted pickup_request to sender
--   acked       ← recipient confirmed decrypt — terminal
--   expired     ← TTL (7 days) elapsed without delivery — terminal
--   cancelled   ← group deleted / recipient blocked / sender uninstalled — terminal
--
-- TTL: 7 days. A cleanup job moves stale `pending`/`in_flight` rows to
-- `expired` so the social-graph metadata doesn't accumulate indefinitely
-- (Plan M1 guard).
--
-- The sender's `device_id` is recorded so pickup_request goes to the
-- specific device that holds the plaintext locally — not to any of the
-- sender's devices generally.

CREATE TABLE IF NOT EXISTS pending_photo_pickups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id UUID NOT NULL REFERENCES challenge_responses(id) ON DELETE CASCADE,
  challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_device_id UUID NOT NULL,
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  state VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'in_flight', 'acked', 'expired', 'cancelled')),
  state_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Only one in-progress pickup per (response, recipient) pair. Terminal
  -- rows can coexist for audit, but we never want two competing "pending"
  -- entries for the same recipient.
  UNIQUE (response_id, recipient_user_id, state)
);

-- Hot path: when a recipient connects, list their non-terminal pickups.
-- Partial index keeps it tight — most rows over time will be terminal.
CREATE INDEX IF NOT EXISTS idx_pending_pickups_recipient_active
  ON pending_photo_pickups(recipient_user_id, created_at DESC)
  WHERE state IN ('pending', 'in_flight');

-- Hot path: TTL cleanup cron scans for stale active rows.
CREATE INDEX IF NOT EXISTS idx_pending_pickups_active_age
  ON pending_photo_pickups(created_at)
  WHERE state IN ('pending', 'in_flight');

-- Hot path: when a recipient acks, jump straight to the right row.
-- (Composite index covers the WHERE on the UPDATE.)
CREATE INDEX IF NOT EXISTS idx_pending_pickups_response_recipient
  ON pending_photo_pickups(response_id, recipient_user_id);

-- Cold path: cascade signals for group deletion / block events to mark
-- whole-group pickups as cancelled in one statement.
CREATE INDEX IF NOT EXISTS idx_pending_pickups_group
  ON pending_photo_pickups(group_id)
  WHERE state IN ('pending', 'in_flight');
