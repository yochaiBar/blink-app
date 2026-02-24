import { query } from './database';
import logger from '../utils/logger';

async function migrate() {
  logger.info('Running migrations...');

  await query(`
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";

    -- Users
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      phone_number VARCHAR(20) UNIQUE NOT NULL,
      display_name VARCHAR(50),
      avatar_url TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      last_active_at TIMESTAMP DEFAULT NOW()
    );

    -- Groups
    CREATE TABLE IF NOT EXISTS groups (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(100) NOT NULL,
      icon VARCHAR(10) DEFAULT '👥',
      category VARCHAR(20) DEFAULT 'friends' CHECK (category IN ('friends', 'family', 'students', 'work', 'custom')),
      created_by UUID REFERENCES users(id),
      invite_code VARCHAR(12) UNIQUE NOT NULL,
      max_members INT DEFAULT 15,
      quiet_hours_start TIME DEFAULT '22:00',
      quiet_hours_end TIME DEFAULT '08:00',
      skip_penalty_type VARCHAR(20) DEFAULT 'wanted_poster' CHECK (skip_penalty_type IN ('wanted_poster', 'avatar_change', 'servant', 'none')),
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- Group Members
    CREATE TABLE IF NOT EXISTS group_members (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(10) DEFAULT 'member' CHECK (role IN ('admin', 'member')),
      joined_at TIMESTAMP DEFAULT NOW(),
      current_streak INT DEFAULT 0,
      total_responses INT DEFAULT 0,
      total_challenges INT DEFAULT 0,
      UNIQUE(group_id, user_id)
    );

    -- Challenges
    CREATE TABLE IF NOT EXISTS challenges (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
      type VARCHAR(20) DEFAULT 'snap' CHECK (type IN ('snap', 'quiz', 'poll', 'blink_test')),
      prompt_text TEXT,
      options_json JSONB,
      triggered_by UUID REFERENCES users(id),
      triggered_at TIMESTAMP DEFAULT NOW(),
      expires_at TIMESTAMP NOT NULL,
      countdown_seconds INT DEFAULT 10,
      status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'expired'))
    );

    -- Challenge Responses
    CREATE TABLE IF NOT EXISTS challenge_responses (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      challenge_id UUID REFERENCES challenges(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id),
      response_type VARCHAR(10) DEFAULT 'photo' CHECK (response_type IN ('photo', 'answer', 'skip')),
      photo_url TEXT,
      answer_index INT,
      responded_at TIMESTAMP DEFAULT NOW(),
      response_time_ms INT,
      UNIQUE(challenge_id, user_id)
    );

    -- Daily Spotlights
    CREATE TABLE IF NOT EXISTS daily_spotlights (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
      featured_user_id UUID REFERENCES users(id),
      superlative TEXT,
      stats_json JSONB,
      date DATE DEFAULT CURRENT_DATE,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(group_id, date)
    );

    -- Skip Penalties (active penalties for users)
    CREATE TABLE IF NOT EXISTS active_penalties (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
      user_id UUID REFERENCES users(id),
      penalty_type VARCHAR(20) NOT NULL,
      penalty_data JSONB,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT NOW()
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);
    CREATE INDEX IF NOT EXISTS idx_challenges_group ON challenges(group_id);
    CREATE INDEX IF NOT EXISTS idx_challenges_status ON challenges(status);
    CREATE INDEX IF NOT EXISTS idx_challenge_responses_challenge ON challenge_responses(challenge_id);
    CREATE INDEX IF NOT EXISTS idx_groups_invite_code ON groups(invite_code);
    CREATE INDEX IF NOT EXISTS idx_daily_spotlights_group_date ON daily_spotlights(group_id, date);
    CREATE INDEX IF NOT EXISTS idx_active_penalties_user ON active_penalties(user_id, group_id);
  `);

  logger.info('Migrations complete!');
  process.exit(0);
}

migrate().catch((err) => {
  logger.error('Migration failed', { error: err.message });
  process.exit(1);
});
