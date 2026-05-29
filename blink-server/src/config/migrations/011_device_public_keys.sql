-- Device X25519 public keys for the E2E photo flow (Phase 2 of the
-- "no server photo storage" plan). Each user's device registers a long-lived
-- X25519 public key on first launch; the corresponding private key never
-- leaves the device.
--
-- The attestation column is HMAC-SHA256(JWT-sub-bytes, public_key_bytes) —
-- it binds the public key to the authenticated identity at registration
-- time, so a compromised server can't substitute its own key during a
-- handshake (Plan H1 guard).
--
-- Tombstoning: on reinstall, the device generates a new keypair. We DO NOT
-- delete the old row — couriers might still try to encrypt to it during a
-- race; we mark it `tombstoned_at` so it's filtered out of any active
-- selection but the audit trail survives (Plan M3 guard).

CREATE TABLE IF NOT EXISTS device_public_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id UUID NOT NULL,
  x25519_public_key TEXT NOT NULL CHECK (char_length(x25519_public_key) = 44),  -- base64(32 bytes) = 44 chars
  attestation TEXT NOT NULL CHECK (char_length(attestation) = 44),               -- base64(32 bytes HMAC-SHA256)
  key_version INTEGER NOT NULL DEFAULT 1,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tombstoned_at TIMESTAMPTZ,
  UNIQUE (user_id, device_id)
);

-- Hot path: courier resolution — find the active device key for a recipient.
-- Partial index: only non-tombstoned rows.
CREATE INDEX IF NOT EXISTS idx_device_public_keys_active_user
  ON device_public_keys(user_id, last_seen DESC)
  WHERE tombstoned_at IS NULL;

-- Hot path: look up by (user_id, device_id) during register / re-register.
-- Already covered by the UNIQUE constraint's implicit index.

-- Cold path: audit + cleanup of dead rows.
CREATE INDEX IF NOT EXISTS idx_device_public_keys_tombstoned
  ON device_public_keys(tombstoned_at)
  WHERE tombstoned_at IS NOT NULL;
