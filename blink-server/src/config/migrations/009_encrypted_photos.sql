-- 009: E2E encrypted photo storage
ALTER TABLE challenge_responses ADD COLUMN IF NOT EXISTS encryption_metadata JSONB;

CREATE TABLE IF NOT EXISTS group_encryption_keys (
  group_id UUID PRIMARY KEY REFERENCES groups(id) ON DELETE CASCADE,
  encrypted_key BYTEA NOT NULL,
  key_version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotated_at TIMESTAMPTZ
);
