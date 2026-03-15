import { query } from '../config/database';
import logger from '../utils/logger';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';

interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default' | null;
  channelId?: string;
}

interface PushTicket {
  id?: string;
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

/**
 * Build authorization headers for the Expo Push API.
 * If EXPO_ACCESS_TOKEN is set, it is included as a Bearer token.
 */
function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };

  if (process.env.EXPO_ACCESS_TOKEN) {
    headers['Authorization'] = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  }

  return headers;
}

/**
 * Send a push notification to a single Expo push token.
 * This is fire-and-forget -- errors are logged but never thrown.
 */
export async function sendPushNotification(
  pushToken: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  if (!pushToken || !pushToken.startsWith('ExponentPushToken[')) {
    logger.debug('Skipping push: invalid or missing token', { pushToken });
    return;
  }

  try {
    const message: PushMessage = {
      to: pushToken,
      title,
      body,
      data: data || {},
      sound: 'default',
    };

    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(message),
    });

    if (!response.ok) {
      const text = await response.text();
      logger.error('Expo Push API HTTP error', {
        status: response.status,
        body: text,
      });
      return;
    }

    const result = (await response.json()) as { data: PushTicket };
    const ticket: PushTicket = result.data;

    if (ticket.status === 'error') {
      logger.error('Expo Push ticket error', {
        error: ticket.details?.error,
        message: ticket.message,
        pushToken,
      });

      // If the token is invalid, clear it from the database
      if (ticket.details?.error === 'DeviceNotRegistered') {
        await clearInvalidToken(pushToken);
      }
    } else if (ticket.id) {
      // Fire-and-forget receipt check after a delay
      setTimeout(() => checkReceipts([ticket.id!]).catch(() => {}), 15_000);
    }
  } catch (err: unknown) {
    logger.error('Failed to send push notification', {
      error: err instanceof Error ? err.message : String(err),
      pushToken,
    });
  }
}

/**
 * Send a batch of push notifications (up to 100 per Expo API call).
 */
async function sendPushBatch(messages: PushMessage[]): Promise<void> {
  if (messages.length === 0) return;

  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(messages),
    });

    if (!response.ok) {
      const text = await response.text();
      logger.error('Expo Push API batch HTTP error', {
        status: response.status,
        body: text,
        count: messages.length,
      });
      return;
    }

    const result = (await response.json()) as { data: PushTicket[] };
    const tickets: PushTicket[] = result.data;
    const receiptIds: string[] = [];

    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      if (ticket.status === 'error') {
        logger.error('Expo Push ticket error (batch)', {
          error: ticket.details?.error,
          message: ticket.message,
          pushToken: messages[i].to,
        });

        if (ticket.details?.error === 'DeviceNotRegistered') {
          clearInvalidToken(messages[i].to).catch(() => {});
        }
      } else if (ticket.id) {
        receiptIds.push(ticket.id);
      }
    }

    // Fire-and-forget receipt check
    if (receiptIds.length > 0) {
      setTimeout(() => checkReceipts(receiptIds).catch(() => {}), 15_000);
    }
  } catch (err: unknown) {
    logger.error('Failed to send push batch', {
      error: err instanceof Error ? err.message : String(err),
      count: messages.length,
    });
  }
}

/**
 * Send push notifications to all members of a group.
 * Optionally exclude a specific user (e.g. the one who triggered the event).
 */
export async function sendPushToGroup(
  groupId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
  excludeUserId?: string
): Promise<void> {
  try {
    let tokenQuery = `
      SELECT u.push_token
      FROM group_members gm
      JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = $1 AND u.push_token IS NOT NULL
    `;
    const params: unknown[] = [groupId];

    if (excludeUserId) {
      tokenQuery += ` AND gm.user_id != $2`;
      params.push(excludeUserId);
    }

    const result = await query(tokenQuery, params);
    const tokens: string[] = result.rows
      .map((r) => r.push_token as string)
      .filter((t) => t && t.startsWith('ExponentPushToken['));

    if (tokens.length === 0) {
      logger.debug('No push tokens for group', { groupId });
      return;
    }

    const messages: PushMessage[] = tokens.map((token) => ({
      to: token,
      title,
      body,
      data: data || {},
      sound: 'default' as const,
    }));

    // Expo Push API supports batches of up to 100 messages
    const BATCH_SIZE = 100;
    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const batch = messages.slice(i, i + BATCH_SIZE);
      // Fire-and-forget each batch
      sendPushBatch(batch).catch(() => {});
    }

    logger.info('Push notifications queued for group', {
      groupId,
      tokenCount: tokens.length,
    });
  } catch (err: unknown) {
    logger.error('Failed to send push to group', {
      error: err instanceof Error ? err.message : String(err),
      groupId,
    });
  }
}

/**
 * Send a push notification to a specific user by their user ID.
 * Looks up their push_token and sends if available.
 */
export async function sendPushToUser(
  userId: string,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> {
  try {
    const result = await query(
      `SELECT push_token FROM users WHERE id = $1`,
      [userId]
    );

    const token = result.rows[0]?.push_token;
    if (!token) {
      logger.debug('No push token for user', { userId });
      return;
    }

    await sendPushNotification(token, title, body, data);
  } catch (err: unknown) {
    logger.error('Failed to send push to user', {
      error: err instanceof Error ? err.message : String(err),
      userId,
    });
  }
}

/**
 * Check push receipt status (called after a delay).
 * This helps detect tokens that became invalid after sending.
 */
async function checkReceipts(receiptIds: string[]): Promise<void> {
  try {
    const response = await fetch(EXPO_RECEIPTS_URL, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ ids: receiptIds }),
    });

    if (!response.ok) return;

    interface PushReceipt {
      status: 'ok' | 'error';
      message?: string;
      details?: { error?: string };
    }
    const result = (await response.json()) as { data: Record<string, PushReceipt> };
    const receipts = result.data || {};

    for (const [id, receipt] of Object.entries(receipts)) {
      if (receipt.status === 'error') {
        logger.warn('Push receipt error', {
          receiptId: id,
          error: receipt.details?.error,
          message: receipt.message,
        });
      }
    }
  } catch (err: unknown) {
    logger.debug('Failed to check push receipts', { error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Clear an invalid push token from the database.
 */
async function clearInvalidToken(pushToken: string): Promise<void> {
  try {
    await query(
      `UPDATE users SET push_token = NULL WHERE push_token = $1`,
      [pushToken]
    );
    logger.info('Cleared invalid push token', { pushToken });
  } catch (err: unknown) {
    logger.error('Failed to clear invalid push token', {
      error: err instanceof Error ? err.message : String(err),
      pushToken,
    });
  }
}
