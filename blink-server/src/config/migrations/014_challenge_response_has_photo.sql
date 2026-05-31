-- Add `has_photo` column to `challenge_responses` for the v2 photo flow
-- (Phase 5 of the no-server-photo-storage plan).
--
-- v1 responses carried `photo_url` pointing at S3. v2 responses carry no
-- URL — the bytes flow peer-to-peer via /api/photos/relay and live only
-- in the recipients' app sandboxes. Both world-views coexist during the
-- migration window; the boolean lets clients tell which kind of response
-- they're rendering.
--
-- Backfill maps existing v1 rows: has_photo = (photo_url IS NOT NULL).
-- `photo_url` is intentionally NOT dropped here — Phase 6's "server v3"
-- drops it once telemetry confirms no client still reads it.

ALTER TABLE challenge_responses
  ADD COLUMN IF NOT EXISTS has_photo BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE challenge_responses
   SET has_photo = TRUE
 WHERE photo_url IS NOT NULL
   AND has_photo = FALSE;
