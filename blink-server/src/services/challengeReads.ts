/**
 * Read models shared by GET /challenges/:id, GET /groups/:id/challenges and
 * GET /feed. Every query is block-aware for the viewer, and responses for
 * a whole page of challenges load in one query (no N+1).
 *
 * No reveal gate: every member sees response metadata; the photos
 * themselves are on the devices already (E2E relay), and hiding them until
 * you've played is a client-side blur.
 */
import { query } from '../config/database';
import { CHALLENGE_SELECT_C } from '../routes/challenges/shared';

export interface ResponseSummary {
  id: string;
  challenge_id: string;
  user_id: string;
  display_name: string;
  has_photo: boolean;
  responded_at: Date;
  response_time_ms: number | null;
  reactions: { emoji: string; count: number }[];
  comment_count: number;
}

export interface ChallengeSummary {
  id: string;
  group_id: string;
  group_name: string;
  group_emoji: string;
  prompt: string | null;
  created_by: string | null;
  created_at: Date;
  expires_at: Date;
  status: string;
  member_count: number;
  response_count: number;
  user_has_responded: boolean;
}

/** Visible responses (with reaction and comment summaries) for each challenge. */
export async function loadResponses(challengeIds: string[], viewerId: string): Promise<Map<string, ResponseSummary[]>> {
  const byChallenge = new Map<string, ResponseSummary[]>(challengeIds.map((id) => [id, []]));
  if (challengeIds.length === 0) return byChallenge;

  const result = await query<ResponseSummary>(
    `SELECT cr.id, cr.challenge_id, cr.user_id, u.display_name, cr.has_photo, cr.responded_at, cr.response_time_ms,
            COALESCE((
              SELECT json_agg(json_build_object('emoji', x.emoji, 'count', x.count) ORDER BY x.count DESC)
                FROM (SELECT r.emoji, COUNT(*)::int AS count FROM reactions r
                       WHERE r.response_id = cr.id AND NOT blocked_between(r.user_id, $2)
                       GROUP BY r.emoji) x
            ), '[]'::json) AS reactions,
            (SELECT COUNT(*)::int FROM response_comments rc
              WHERE rc.response_id = cr.id AND rc.deleted_at IS NULL
                AND NOT blocked_between(rc.user_id, $2)) AS comment_count
       FROM challenge_responses cr
       JOIN public_users u ON u.id = cr.user_id
      WHERE cr.challenge_id = ANY($1::uuid[]) AND NOT blocked_between(cr.user_id, $2)
      ORDER BY cr.responded_at`,
    [challengeIds, viewerId],
  );
  for (const row of result.rows) byChallenge.get(row.challenge_id)?.push(row);
  return byChallenge;
}

/**
 * Challenges matching `where` (SQL over alias c; viewer is $1, extra params
 * start at $2), newest first, as the viewer sees them.
 */
export async function listChallenges(
  where: string,
  params: unknown[],
  viewerId: string,
  limit: number,
): Promise<ChallengeSummary[]> {
  const result = await query<ChallengeSummary>(
    `SELECT ${CHALLENGE_SELECT_C}, g.name AS group_name, g.icon AS group_emoji,
            (SELECT COUNT(*)::int FROM group_members WHERE group_id = c.group_id) AS member_count,
            (SELECT COUNT(*)::int FROM challenge_responses cr
              WHERE cr.challenge_id = c.id AND NOT blocked_between(cr.user_id, $1)) AS response_count,
            EXISTS (SELECT 1 FROM challenge_responses cr WHERE cr.challenge_id = c.id AND cr.user_id = $1)
              AS user_has_responded
       FROM challenges c
       JOIN groups g ON g.id = c.group_id
      WHERE ${where}
      ORDER BY c.created_at DESC
      LIMIT ${Number(limit)}`,
    [viewerId, ...params],
  );
  return result.rows;
}
