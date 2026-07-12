-- Group key versioning for the E2E photo flow (recovery + regeneration).
--
-- The server never sees the group key, but it CAN track a monotonic version
-- number so the app can resolve key rotations deterministically: when an
-- admin regenerates a group's key (POST /api/keyshare/reset), this counter
-- is bumped and a `group:key_rotated` event fans out. Members holding an
-- older version pull the new key via the recovery handshake and overwrite
-- their stale copy (higher version wins on the client), instead of the old
-- "refuse to overwrite a conflicting key" behaviour that would otherwise
-- brick rotation.
--
-- Existing groups default to version 1 to match keys already generated at
-- create/join time (which the app treats as version 1).

ALTER TABLE groups
  ADD COLUMN IF NOT EXISTS group_key_version INTEGER NOT NULL DEFAULT 1;
