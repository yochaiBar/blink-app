-- Photo response comments — 1-level threaded.
-- See ~/Documents/Obsidian Vault/Blink/Plans/Photo comments.md

CREATE TABLE IF NOT EXISTS response_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  response_id UUID NOT NULL REFERENCES challenge_responses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_comment_id UUID REFERENCES response_comments(id) ON DELETE CASCADE,
  text TEXT NOT NULL CHECK (char_length(text) BETWEEN 1 AND 280),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- Hot path: list comments for a single photo, newest first
CREATE INDEX IF NOT EXISTS idx_response_comments_response
  ON response_comments(response_id, created_at)
  WHERE deleted_at IS NULL;

-- Hot path: find replies for a top-level comment
CREATE INDEX IF NOT EXISTS idx_response_comments_parent
  ON response_comments(parent_comment_id)
  WHERE parent_comment_id IS NOT NULL AND deleted_at IS NULL;

-- Cold path: GDPR-style "all my comments"
CREATE INDEX IF NOT EXISTS idx_response_comments_user
  ON response_comments(user_id);
