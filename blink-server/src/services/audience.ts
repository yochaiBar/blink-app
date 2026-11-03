/**
 * Who may see or be notified about an actor's activity in a group.
 *
 * Wrappers around the SQL functions in 001_baseline.sql, which queries can
 * also use inline:
 *   - blocked_between(a, b): either user blocked the other.
 *   - audience(group, actor): the group's other members, minus anyone
 *     blocked_between them and the actor.
 * Relay recipients, pushes, notifications, comments, reactions and the feed
 * all go through these, so a block hides both users from each other
 * everywhere at once.
 */
import { query } from '../config/database';

export async function audienceOf(groupId: string, actorId: string): Promise<string[]> {
  const result = await query<{ user_id: string }>(`SELECT user_id FROM audience($1, $2)`, [groupId, actorId]);
  return result.rows.map((r) => r.user_id);
}

export async function isBlockedBetween(a: string, b: string): Promise<boolean> {
  const result = await query<{ blocked: boolean }>(`SELECT blocked_between($1, $2) AS blocked`, [a, b]);
  return result.rows[0]?.blocked === true;
}
