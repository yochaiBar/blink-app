/**
 * Database row type interfaces.
 *
 * Each interface mirrors the columns of its corresponding PostgreSQL table
 * as defined in src/config/migrations/001_baseline.sql. Use them to
 * parameterise the generic `query<T>(...)` helper so that `result.rows`
 * is properly typed.
 */

// ── Core tables ──────────────────────────────────────────────────

export interface UserRow {
  id: string;
  phone_number: string;
  display_name: string | null;
  bio: string | null;
  push_token: string | null;
  created_at: Date;
  last_active_at: Date;
}

export interface GroupRow {
  id: string;
  name: string;
  icon: string;
  created_by: string | null;
  invite_code: string;
  max_members: number;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  group_streak: number;
  longest_group_streak: number;
  group_key_version: number;
  created_at: Date;
}

export interface GroupMemberRow {
  id: string;
  group_id: string;
  user_id: string;
  role: string;
  joined_at: Date;
  current_streak: number;
  total_responses: number;
  total_challenges: number;
}

export interface ChallengeRow {
  id: string;
  group_id: string;
  prompt: string | null;
  /** NULL for scheduler-created challenges and after the creator deletes their account. */
  created_by: string | null;
  created_at: Date;
  expires_at: Date;
  status: string;
  is_auto_generated: boolean;
}

export interface ChallengeResponseRow {
  id: string;
  challenge_id: string;
  user_id: string;
  /** The photo itself never reaches the server; it travels via /api/photos/relay. */
  has_photo: boolean;
  responded_at: Date;
  response_time_ms: number | null;
}

// ── Supporting tables ────────────────────────────────────────────

export interface ReactionRow {
  id: string;
  response_id: string;
  user_id: string;
  emoji: string;
  created_at: Date;
}

// ── Convenience types for common JOIN / aggregate shapes ─────────

/** Returned by COUNT(*) queries */
export interface CountRow {
  count: string;
}

/** User display name only (common lookup) */
export interface UserDisplayNameRow {
  display_name: string | null;
}
