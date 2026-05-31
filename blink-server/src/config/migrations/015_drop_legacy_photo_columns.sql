-- Phase 6b — drop the legacy server-side encryption surface.
--
-- IRREVERSIBLE IN PRODUCTION:
--   • challenge_responses.encryption_metadata is gone. Phase 6a server
--     no longer reads or writes it; any v1 client that still expects
--     it gets HTTP 426 from /upload/* before reaching this code path.
--   • group_encryption_keys table is gone. Group keys now live only
--     on member devices via the Phase 4 courier handshake — the
--     server never had a copy of the unwrapped key anyway, but the
--     wrapped-with-ENCRYPTION_MASTER_KEY rows here are dead weight.
--
-- NOT dropped this migration:
--   • challenge_responses.photo_url — still referenced by Phase 6a's
--     SELECT in queries.ts and INSERT in challengeService. Dropping
--     it would crash a running server. Queued for a follow-up
--     migration (016) once those references are stripped.
--
-- migrationRunner chains `migrate && start`, so a failure here aborts
-- container start and Railway reverts to the previous green image.

ALTER TABLE challenge_responses
  DROP COLUMN IF EXISTS encryption_metadata;

DROP TABLE IF EXISTS group_encryption_keys;
