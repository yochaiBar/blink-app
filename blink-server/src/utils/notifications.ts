import { query } from '../config/database';
import logger from './logger';

/**
 * Insert a notification for a user.
 */
export async function createNotification(
  userId: string,
  type: string,
  title: string,
  body: string,
  groupId?: string,
  fromUserId?: string
) {
  try {
    await query(
      `INSERT INTO notifications (user_id, type, title, body, group_id, from_user_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, type, title, body, groupId || null, fromUserId || null]
    );
  } catch (err: any) {
    logger.error('Failed to create notification', { error: err.message, userId, type });
  }
}
