-- Engagement Features: Group Streaks + Streak Shields

-- Group-level streak tracking
ALTER TABLE groups ADD COLUMN IF NOT EXISTS group_streak INT DEFAULT 0;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS longest_group_streak INT DEFAULT 0;

-- Streak shields for users
CREATE TABLE IF NOT EXISTS streak_shields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
  earned_at TIMESTAMP DEFAULT NOW(),
  used_at TIMESTAMP,
  used_for_challenge_id UUID REFERENCES challenges(id),
  UNIQUE(user_id, group_id, earned_at)
);
CREATE INDEX IF NOT EXISTS idx_streak_shields_user_group ON streak_shields(user_id, group_id);

-- Streak milestones log
CREATE TABLE IF NOT EXISTS streak_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
  milestone INT NOT NULL,
  reached_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, group_id, milestone)
);
CREATE INDEX IF NOT EXISTS idx_streak_milestones_user_group ON streak_milestones(user_id, group_id);
