-- AI Foundation: auto-generated challenges + generation log

ALTER TABLE challenges ADD COLUMN IF NOT EXISTS is_auto_generated BOOLEAN DEFAULT FALSE;
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS ai_generated_prompt TEXT;

CREATE TABLE IF NOT EXISTS challenge_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID UNIQUE REFERENCES groups(id) ON DELETE CASCADE,
  last_auto_challenge_at TIMESTAMP,
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_challenge_schedule_group ON challenge_schedule(group_id);

CREATE TABLE IF NOT EXISTS ai_generation_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
  function_name VARCHAR(50) NOT NULL,
  personality VARCHAR(30),
  tokens_used INT,
  latency_ms INT,
  fallback_used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_gen_log_group ON ai_generation_log(group_id);

-- AI commentary cache on challenges
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS ai_commentary TEXT;
