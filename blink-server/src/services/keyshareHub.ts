/**
 * Group-key courier handshake hub (protocol v2).
 *
 * Flow
 * ────
 *   1. A joiner (or a member who lost the key) gets a `pending_joins` row
 *      for (group, user) naming the device that needs the key.
 *   2. Whenever that device and a member holding the group's CURRENT key
 *      version (confirmed via /confirm) are both online, the row is claimed
 *      for that courier with a short lease and `group:keyshare_request` is
 *      sent to it. An unanswered lease just expires; the next connect of
 *      either party offers the row again.
 *   3. The courier encrypts the key to the device client-side and POSTs it
 *      to /deliver. Only the claiming courier, while both are still
 *      members, at the current version, may deliver; the envelope goes only
 *      to `user-device:<joiner>:<device>`.
 *   4. The joiner's device confirms it holds the key (/confirm), which
 *      deletes the row and makes it a courier too.
 *
 * Reset is two steps: /reset bumps the version (and frees every claim);
 * the admin's device mints a key at that version and confirms it, and only
 * then does the group hear `group:key_rotated` — so members never ask for
 * a key nobody holds yet.
 *
 * The server never touches the group key; envelopes are opaque ciphertext.
 */

import { query, withTransaction } from '../config/database';
import {
  emitToGroup,
  emitToUser,
  emitToUserDevice,
  isDeviceOnline,
  isUserOnline,
  onDeviceReady,
  onUserConnect,
} from '../socket';
import { HttpError } from '../utils/httpError';
import logger from '../utils/logger';
import type {
  KeyRotatedEvent,
  KeyshareDeliverRequest,
  KeyshareEnvelope,
  KeyshareRequest,
} from '../shared/photoProtocol';

/** How long a claimed join waits for the courier's envelope before it's offered again. */
export const KEYSHARE_LEASE_SECONDS = 120;
const PENDING_JOIN_TTL_DAYS = 7;

// ── Enqueue ───────────────────────────────────────────────────────

export interface EnqueueKeyshareArgs {
  groupId: string;
  joinerUserId: string;
  joinerDeviceId: string;
}

/**
 * Upsert the (group, joiner) row for `joinerDeviceId`. A repeat request
 * (another device, a retry) replaces the device and frees any claim.
 */
export async function enqueueKeyshare(args: EnqueueKeyshareArgs): Promise<void> {
  await query(
    `INSERT INTO pending_joins (group_id, joiner_user_id, joiner_device_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (group_id, joiner_user_id) DO UPDATE
       SET joiner_device_id = EXCLUDED.joiner_device_id,
           courier_user_id = NULL,
           lease_expires_at = NULL,
           created_at = NOW()`,
    [args.groupId, args.joinerUserId, args.joinerDeviceId],
  );
}

/**
 * A member without the current key asks for it on `requesterDeviceId`. They
 * no longer count as a holder, so they aren't asked to courier meanwhile.
 * Caller (route) verifies membership first.
 */
export async function requestKeyshareRecovery(args: {
  groupId: string;
  requesterUserId: string;
  requesterDeviceId: string;
}): Promise<{ enqueued: boolean; couriersNotified: number }> {
  await query(`UPDATE group_members SET key_version = NULL WHERE group_id = $1 AND user_id = $2`, [
    args.groupId,
    args.requesterUserId,
  ]);
  await enqueueKeyshare({
    groupId: args.groupId,
    joinerUserId: args.requesterUserId,
    joinerDeviceId: args.requesterDeviceId,
  });
  const couriersNotified = await dispatchKeysharesFor(args.requesterUserId);
  logger.info('keyshare recovery requested', { couriers_notified: couriersNotified });
  return { enqueued: true, couriersNotified };
}

// ── Dispatch ──────────────────────────────────────────────────────

interface CandidateRow {
  id: string;
  group_id: string;
  joiner_user_id: string;
  joiner_device_id: string;
  group_key_version: number;
}

/** Holders of the group's current key version, `preferred` first, then by seniority. */
async function onlineCourier(row: CandidateRow, preferred: string): Promise<string | null> {
  const holders = await query<{ user_id: string }>(
    `SELECT user_id FROM group_members
      WHERE group_id = $1 AND key_version = $2 AND user_id <> $3
      ORDER BY (user_id = $4) DESC, joined_at ASC`,
    [row.group_id, row.group_key_version, row.joiner_user_id, preferred],
  );
  for (const { user_id } of holders.rows) {
    if (await isUserOnline(user_id)) return user_id;
  }
  return null;
}

/**
 * Offer every free (unclaimed or lapsed) pending join that `userId` takes
 * part in — as the joiner, or as a holder of the current key — whose joiner
 * device and some courier are online now. Returns how many requests went out.
 */
export async function dispatchKeysharesFor(userId: string): Promise<number> {
  const candidates = await query<CandidateRow>(
    `SELECT pj.id, pj.group_id, pj.joiner_user_id, pj.joiner_device_id, g.group_key_version
       FROM pending_joins pj
       JOIN groups g ON g.id = pj.group_id
      WHERE (pj.lease_expires_at IS NULL OR pj.lease_expires_at < NOW())
        AND (pj.joiner_user_id = $1
             OR EXISTS (SELECT 1 FROM group_members gm
                         WHERE gm.group_id = pj.group_id AND gm.user_id = $1
                           AND gm.key_version = g.group_key_version))`,
    [userId],
  );

  let sent = 0;
  for (const row of candidates.rows) {
    if (!(await isDeviceOnline(row.joiner_user_id, row.joiner_device_id))) continue;
    const key = await query<{ x25519_public_key: string }>(
      `SELECT x25519_public_key FROM device_public_keys
        WHERE user_id = $1 AND device_id = $2 AND tombstoned_at IS NULL`,
      [row.joiner_user_id, row.joiner_device_id],
    );
    if (key.rows.length === 0) continue; // device key not registered (yet)
    const courier = await onlineCourier(row, userId);
    if (!courier) continue;

    // Atomic claim: only one dispatcher wins a free (or lapsed) lease.
    const claim = await query(
      `UPDATE pending_joins
          SET courier_user_id = $2, lease_expires_at = NOW() + make_interval(secs => $3)
        WHERE id = $1 AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
        RETURNING id`,
      [row.id, courier, KEYSHARE_LEASE_SECONDS],
    );
    if (claim.rows.length === 0) continue;

    const request: KeyshareRequest = {
      v: 2,
      pending_join_id: row.id,
      group_id: row.group_id,
      joiner_user_id: row.joiner_user_id,
      joiner_device_id: row.joiner_device_id,
      joiner_x25519_public_key_b64: key.rows[0].x25519_public_key,
      key_version: row.group_key_version,
    };
    // Any of the courier's devices holding the key may answer.
    emitToUser(courier, 'group:keyshare_request', request);
    sent++;
  }

  if (sent > 0) logger.info('keyshare requests dispatched', { request_count: sent });
  return sent;
}

// ── Deliver ───────────────────────────────────────────────────────

interface DeliverRow {
  group_id: string;
  joiner_user_id: string;
  joiner_device_id: string;
  courier_user_id: string | null;
  group_key_version: number;
  courier_key_version: number | null;
  courier_is_member: boolean;
  joiner_is_member: boolean;
}

/**
 * Forward a courier's envelope to the joiner's device. The row stays until
 * the joiner confirms, so a missed envelope is simply offered again.
 */
export async function deliverKeyshare(callerUserId: string, body: KeyshareDeliverRequest): Promise<void> {
  const result = await query<DeliverRow>(
    `SELECT pj.group_id, pj.joiner_user_id, pj.joiner_device_id, pj.courier_user_id, g.group_key_version,
            cm.key_version AS courier_key_version,
            cm.user_id IS NOT NULL AS courier_is_member,
            EXISTS (SELECT 1 FROM group_members jm
                     WHERE jm.group_id = pj.group_id AND jm.user_id = pj.joiner_user_id) AS joiner_is_member
       FROM pending_joins pj
       JOIN groups g ON g.id = pj.group_id
       LEFT JOIN group_members cm ON cm.group_id = pj.group_id AND cm.user_id = $2
      WHERE pj.id = $1`,
    [body.pending_join_id, callerUserId],
  );
  const row = result.rows[0];
  if (!row || !row.joiner_is_member) throw new HttpError(404, 'Pending join not found');
  if (row.courier_user_id !== callerUserId || !row.courier_is_member) {
    throw new HttpError(403, 'Not the courier for this join');
  }
  if (body.key_version !== row.group_key_version || row.courier_key_version !== row.group_key_version) {
    throw new HttpError(409, 'Group key version mismatch');
  }

  const envelope: KeyshareEnvelope = {
    v: 2,
    pending_join_id: body.pending_join_id,
    group_id: row.group_id,
    from_user_id: callerUserId,
    from_device_id: body.from_device_id,
    key_version: body.key_version,
    ephemeral_public_key_b64: body.ephemeral_public_key_b64,
    iv_b64: body.iv_b64,
    ciphertext_b64: body.ciphertext_b64,
  };
  emitToUserDevice(row.joiner_user_id, row.joiner_device_id, 'group:keyshare_envelope', envelope);
  logger.info('keyshare delivered');
}

// ── Confirm / reset ───────────────────────────────────────────────

/**
 * The caller's device now holds the key at `keyVersion` (409 unless it's
 * current). Ends their pending join and makes them a courier. The first
 * holder of a version after a reset fans out `group:key_rotated`.
 */
export async function confirmGroupKey(callerUserId: string, groupId: string, keyVersion: number): Promise<void> {
  const rotated = await withTransaction(async (client) => {
    // Lock the group row so a concurrent reset can't slip between the
    // version check and the update.
    const group = await client.query<{ group_key_version: number }>(
      `SELECT group_key_version FROM groups WHERE id = $1 FOR UPDATE`,
      [groupId],
    );
    if (group.rows[0]?.group_key_version !== keyVersion) throw new HttpError(409, 'Group key version mismatch');
    const others = await client.query(
      `SELECT 1 FROM group_members WHERE group_id = $1 AND key_version = $2 AND user_id <> $3 LIMIT 1`,
      [groupId, keyVersion, callerUserId],
    );
    const changed = await client.query(
      `UPDATE group_members SET key_version = $3
        WHERE group_id = $1 AND user_id = $2 AND key_version IS DISTINCT FROM $3
        RETURNING 1`,
      [groupId, callerUserId, keyVersion],
    );
    await client.query(`DELETE FROM pending_joins WHERE group_id = $1 AND joiner_user_id = $2`, [
      groupId,
      callerUserId,
    ]);
    return keyVersion > 1 && changed.rows.length > 0 && others.rows.length === 0;
  });

  if (rotated) {
    const event: KeyRotatedEvent = { v: 2, group_id: groupId, group_key_version: keyVersion };
    emitToGroup(groupId, 'group:key_rotated', event);
    logger.info('group key rotated', { group_key_version: keyVersion });
  }
  await dispatchKeysharesFor(callerUserId);
}

/**
 * Reset, step one (admin only): bump the version and free every claim made
 * under the old one. Nobody holds the new version until the admin confirms.
 */
export async function resetGroupKey(callerUserId: string, groupId: string): Promise<number> {
  return withTransaction(async (client) => {
    const role = await client.query<{ role: string }>(
      `SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2`,
      [groupId, callerUserId],
    );
    if (role.rows[0]?.role !== 'admin') throw new HttpError(403, 'Only a group admin can reset the secure key');
    const bump = await client.query<{ group_key_version: number }>(
      `UPDATE groups SET group_key_version = group_key_version + 1 WHERE id = $1 RETURNING group_key_version`,
      [groupId],
    );
    await client.query(`UPDATE pending_joins SET courier_user_id = NULL, lease_expires_at = NULL WHERE group_id = $1`, [
      groupId,
    ]);
    logger.info('group key reset', { group_key_version: bump.rows[0].group_key_version });
    return bump.rows[0].group_key_version;
  });
}

// ── Registration + cleanup ────────────────────────────────────────

let registered = false;

/**
 * Wire dispatch-on-connect: a courier connecting, or the joiner's device
 * identifying itself, may make pending joins deliverable. Idempotent.
 */
export function registerKeyshareHub(): void {
  if (registered) return;
  registered = true;
  onUserConnect(async (userId) => {
    await dispatchKeysharesFor(userId);
  });
  onDeviceReady(async (userId) => {
    await dispatchKeysharesFor(userId);
  });
}

/** Delete pending joins older than the TTL. */
export async function reapOldPendingJoins(): Promise<number> {
  const result = await query(`DELETE FROM pending_joins WHERE created_at < NOW() - make_interval(days => $1)`, [
    PENDING_JOIN_TTL_DAYS,
  ]);
  return result.rowCount ?? 0;
}
