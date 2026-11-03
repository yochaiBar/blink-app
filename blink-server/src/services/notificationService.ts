import { query } from '../config/database';
import { emitToGroup } from '../socket';
import { createNotification } from '../utils/notifications';
import { sendPushToGroup, sendPushToUser } from './pushNotifications';
import { UserDisplayNameRow } from '../types/db';

/** User summary row used in notification queries */
interface UserSummaryRow {
  user_id: string;
  display_name: string;
}

/**
 * Notify the challenge creator that someone responded to their challenge.
 */
export async function notifyUserOfResponse(
  triggeredBy: string,
  responderId: string,
  groupId: string,
  challengeId: string,
): Promise<void> {
  const responderUser = await query<UserDisplayNameRow>(`SELECT display_name FROM public_users WHERE id = $1`, [
    responderId,
  ]);
  const responderName = responderUser.rows[0]?.display_name || 'Someone';

  await createNotification(
    triggeredBy,
    'snap_received',
    'New Response!',
    `${responderName} responded to your challenge`,
    groupId,
    responderId,
  );

  // Fire-and-forget push notification to challenge creator
  sendPushToUser(triggeredBy, 'New Response!', `${responderName} responded to your challenge`, {
    type: 'snap_received',
    groupId,
    challengeId,
  }).catch(() => {});
}

/**
 * Social Obligation Loop: notify non-responders about who has already responded.
 * Emits a challenge:progress socket event and sends personalized push messages.
 */
export async function notifySocialObligation(challengeId: string, groupId: string): Promise<void> {
  // Get all group members with names
  const allMembers = await query<UserSummaryRow>(
    `SELECT gm.user_id, u.display_name
     FROM group_members gm
     JOIN public_users u ON u.id = gm.user_id
     WHERE gm.group_id = $1`,
    [groupId],
  );

  // Get who has responded so far
  const allResponded = await query<UserSummaryRow>(
    `SELECT cr.user_id, u.display_name
     FROM challenge_responses cr
     JOIN public_users u ON u.id = cr.user_id
     WHERE cr.challenge_id = $1`,
    [challengeId],
  );
  const respondedUserIds = new Set(allResponded.rows.map((r) => r.user_id));

  // Emit challenge:progress socket event
  emitToGroup(groupId, 'challenge:progress', {
    challengeId,
    respondedCount: allResponded.rows.length,
    totalMembers: allMembers.rows.length,
    respondedUsers: allResponded.rows.map((r) => ({
      userId: r.user_id,
      displayName: r.display_name,
    })),
  });

  // Build personalized push messages for non-responders
  const respondedNames = allResponded.rows.map((r) => r.display_name || 'Someone');
  const nonResponders = allMembers.rows.filter((m) => !respondedUserIds.has(m.user_id));

  for (const pending of nonResponders) {
    let pushBody: string;
    if (respondedNames.length === 1) {
      pushBody = `${respondedNames[0]} already responded. Your turn!`;
    } else if (respondedNames.length === 2) {
      pushBody = `${respondedNames[0]} and ${respondedNames[1]} already responded — don't leave them hanging!`;
    } else {
      const othersCount = respondedNames.length - 2;
      pushBody = `${respondedNames[0]}, ${respondedNames[1]} and ${othersCount} other${othersCount > 1 ? 's' : ''} responded — you're the only ones left!`;
    }

    sendPushToUser(pending.user_id, 'Your friends are waiting!', pushBody, {
      type: 'social_obligation',
      groupId,
      challengeId,
    }).catch(() => {});
  }
}

/**
 * Notify all group members (except the triggerer) about a new challenge.
 */
export async function notifyGroupOfChallenge(groupId: string, challengeId: string, triggeredBy: string): Promise<void> {
  // The trigger-er's audience: other members, minus anyone blocked with them.
  const groupMembers = await query<{ user_id: string }>(`SELECT user_id FROM audience($1, $2)`, [groupId, triggeredBy]);
  const triggerUser = await query<UserDisplayNameRow>(`SELECT display_name FROM public_users WHERE id = $1`, [
    triggeredBy,
  ]);
  const triggerName = triggerUser.rows[0]?.display_name || 'Someone';
  const groupInfo = await query<{ name: string }>(`SELECT name FROM groups WHERE id = $1`, [groupId]);
  const groupName = groupInfo.rows[0]?.name || 'your group';

  for (const member of groupMembers.rows) {
    await createNotification(
      member.user_id,
      'challenge_started',
      'New Challenge!',
      `${triggerName} started a snap challenge in ${groupName}`,
      groupId,
      triggeredBy,
    );
  }

  // Fire-and-forget push notification to group members
  sendPushToGroup(
    groupId,
    'New Challenge!',
    `${triggerName} started a snap challenge in ${groupName}`,
    { type: 'challenge_started', challengeId, groupId, challengeType: 'snap', screen: 'challenge' },
    triggeredBy,
  ).catch(() => {});
}
