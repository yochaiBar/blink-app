-- Group-key courier handshake at join (Phase 4 of the no-server-photo-storage plan).
--
-- When a new member joins a group, the server creates a `pending` row here.
-- The first online existing member of that group becomes the courier (atomic
-- pending → in_flight claim), runs X25519 ECDH + AES-GCM client-side to
-- encrypt the group key for the joiner's device public key, and POSTs the
-- opaque envelope to /api/keyshare/deliver. The server emits to the joiner
-- and marks the row `delivered`. Server never sees the group key.
--
-- Race resolution: only one courier per pending row at a time. Other online
-- members get `group:keyshare_cancelled` and ignore. The atomic UPDATE
-- guarantees only one wins.
--
-- TTL: 7 days (matches pending_photo_pickups). After that we mark `expired`
-- so social-graph metadata doesn't accumulate. The joiner can request a
-- fresh handshake by leaving + rejoining if it ever expires in practice.
--
-- The joiner's device public key is NOT stored here — the courier looks it
-- up live from `device_public_keys` at emit time so a reinstall between
-- join and handshake gets the new key (not a tombstoned old one).

CREATE TABLE IF NOT EXISTS pending_joins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  joiner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joiner_device_id UUID NOT NULL,
  state VARCHAR(16) NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'in_flight', 'delivered', 'expired', 'cancelled')),
  state_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- At most one active row per (group, joiner). Terminal rows can coexist
  -- so we keep an audit trail.
  UNIQUE (group_id, joiner_user_id, state)
);

-- Hot path: when a courier connects, find all groups where they can serve
-- a pending join. The most efficient form is to scan pending rows and
-- filter membership in the query — this index supports the scan.
CREATE INDEX IF NOT EXISTS idx_pending_joins_active
  ON pending_joins(group_id, created_at DESC)
  WHERE state IN ('pending', 'in_flight');

-- Hot path: TTL cleanup cron.
CREATE INDEX IF NOT EXISTS idx_pending_joins_active_age
  ON pending_joins(created_at)
  WHERE state IN ('pending', 'in_flight');

-- Hot path: looking up the row at delivery time to mark delivered.
CREATE INDEX IF NOT EXISTS idx_pending_joins_joiner
  ON pending_joins(joiner_user_id)
  WHERE state IN ('pending', 'in_flight');
