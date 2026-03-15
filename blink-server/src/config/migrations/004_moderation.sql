-- Content Reports
CREATE TABLE IF NOT EXISTS content_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reported_content_id UUID,
  content_type VARCHAR(20) NOT NULL CHECK (content_type IN ('photo', 'user', 'group', 'challenge_response')),
  reason VARCHAR(50) NOT NULL CHECK (reason IN ('inappropriate', 'spam', 'harassment', 'hate_speech', 'nudity', 'violence', 'other')),
  description TEXT,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'dismissed')),
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_content_reports_reporter ON content_reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_content_reports_reported_user ON content_reports(reported_user_id);

-- User Blocks
CREATE TABLE IF NOT EXISTS user_blocks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(blocker_id, blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocker ON user_blocks(blocker_id);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks(blocked_id);

-- AI Personality for groups
ALTER TABLE groups ADD COLUMN IF NOT EXISTS ai_personality VARCHAR(30) DEFAULT 'funny'
  CHECK (ai_personality IN ('family_friendly', 'funny', 'spicy', 'sarcastic', 'motivational', 'extreme', 'sexy', 'no_filter'));

-- Bio column for user profiles
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;

-- Prompt support: add answer_text column for open-text prompt responses
ALTER TABLE challenge_responses ADD COLUMN IF NOT EXISTS answer_text TEXT;

-- Prompt support: expand challenges.type CHECK to include 'prompt'
-- DROP old constraint then ADD new one (IF EXISTS guard for idempotency)
DO $$
BEGIN
  ALTER TABLE challenges DROP CONSTRAINT IF EXISTS challenges_type_check;
  ALTER TABLE challenges ADD CONSTRAINT challenges_type_check
    CHECK (type IN ('snap', 'quiz', 'poll', 'blink_test', 'prompt'));
END $$;

-- Push notification token for Expo Push API
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token TEXT;

-- Content Moderation Log (AWS Rekognition results)
CREATE TABLE IF NOT EXISTS content_moderation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  content_type VARCHAR(20) DEFAULT 'image',
  s3_key TEXT,
  safe BOOLEAN,
  labels JSONB,
  confidence NUMERIC,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_content_moderation_log_user ON content_moderation_log(user_id);
CREATE INDEX IF NOT EXISTS idx_content_moderation_log_safe ON content_moderation_log(safe);
