import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody } from '../middleware/validate';
import {
  keyshareDeliverSchema,
  keyshareRequestSchema,
  keyshareResetSchema,
} from '../utils/schemas';
import { query } from '../config/database';
import {
  markKeyshareDelivered,
  requestKeyshareRecovery,
} from '../services/keyshareHub';
import { emitToGroup } from '../socket';
import logger from '../utils/logger';
import type { KeyshareEnvelope } from '../shared/photoProtocol';

// ─────────────────────────────────────────────────────────────────
// POST /api/keyshare/deliver
//
// Courier-side endpoint: the device that ran `courierEncryptGroupKey`
// hands the opaque envelope back to the server here, addressed to a
// pending_join row. The server forwards via Socket.io
// `group:keyshare_envelope` to the joiner's room — server can't decrypt
// the contents, only routes them.
//
// Authorization
// ─────────────
//   • Caller must be authenticated (handled by `authenticate` above).
//   • Caller's user_id must match `from_user_id` in the body (no spoofing
//     someone else as the courier in the audit trail).
//   • Caller must be a current member of the group_id in the body
//     (defense in depth — a malicious client could try to relay a
//     keyshare for a group they aren't in).
//   • The pending_join row's group_id must match the body's group_id
//     (catches a swap between body and row).
//
// We do NOT verify the courier is the elected one for this pending row.
// The first courier to deliver wins; later POSTs against the same row
// return 200 with `delivered: false` and don't re-emit. This avoids races
// where the elected courier failed silently (e.g. crashed mid-encrypt)
// and a backup device needs to take over.
// ─────────────────────────────────────────────────────────────────

const router = Router();
router.use(authenticate);

interface PendingJoinAuthRow {
  joiner_user_id: string;
  group_id: string;
  state: string;
}

router.post(
  '/deliver',
  validateBody(keyshareDeliverSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const body = req.body as KeyshareEnvelope;
    const callerUserId = req.userId!;

    if (body.from_user_id !== callerUserId) {
      // The courier must identify themselves as themselves.
      res.status(403).json({ error: 'from_user_id does not match caller' });
      return;
    }

    // Pull the pending_join row to validate group + check state.
    const pending = await query<PendingJoinAuthRow>(
      `SELECT joiner_user_id, group_id, state
         FROM pending_joins
        WHERE id = $1`,
      [body.pending_join_id],
    );
    const row = pending.rows[0];
    if (!row) {
      res.status(404).json({ error: 'Pending join not found' });
      return;
    }
    if (row.group_id !== body.group_id) {
      res.status(400).json({ error: 'group_id mismatch' });
      return;
    }
    // If the row already terminated (delivered / expired / cancelled),
    // return 200 with delivered=false rather than erroring — late
    // couriers shouldn't disrupt the joiner with a 4xx; they should just
    // quietly do nothing.
    if (row.state !== 'pending' && row.state !== 'in_flight') {
      res.status(200).json({ v: 1, delivered: false });
      return;
    }

    // Verify the caller is a member of the group at NOW (not at row
    // creation) — handles leave-then-spoof scenarios.
    const membership = await query(
      `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`,
      [body.group_id, callerUserId],
    );
    if (membership.rows.length === 0) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    // Hand to the hub — it does the atomic flip + emit.
    const result = await markKeyshareDelivered({
      pendingJoinId: body.pending_join_id,
      joinerUserId: row.joiner_user_id,
      envelope: body,
    });

    res.status(200).json({ v: 1, delivered: result.deliveredThisCall });
  }),
);

// ─────────────────────────────────────────────────────────────────
// POST /api/keyshare/request
//
// Recovery entry point: a member who belongs to the group but has no local
// group key asks online members to re-courier it. Reuses the pending_joins
// machinery via `requestKeyshareRecovery`. Server stays blind to the key.
//
// Authorization: caller must be a CURRENT member of the group.
// ─────────────────────────────────────────────────────────────────
router.post(
  '/request',
  validateBody(keyshareRequestSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { group_id, device_id } = req.body as { group_id: string; device_id: string };
    const callerUserId = req.userId!;

    const membership = await query(
      `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`,
      [group_id, callerUserId],
    );
    if (membership.rows.length === 0) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    const result = await requestKeyshareRecovery({
      groupId: group_id,
      requesterUserId: callerUserId,
      requesterDeviceId: device_id,
    });

    res.status(200).json({
      v: 1,
      enqueued: result.enqueued,
      couriers_notified: result.couriersNotified,
    });
  }),
);

// ─────────────────────────────────────────────────────────────────
// POST /api/keyshare/reset
//
// Regeneration entry point: for the case where NO member holds the key
// (e.g. a pre-migration group whose server-side key was dropped), an admin
// bumps the group's key version. The server only tracks the version — it
// never sees the key. The admin's device then generates a fresh key at the
// new version and members pull it via the recovery path. Members already
// holding an OLDER version overwrite it because version-wins on the client.
//
// Authorization: caller must be an ADMIN of the group.
// ─────────────────────────────────────────────────────────────────
router.post(
  '/reset',
  validateBody(keyshareResetSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { group_id } = req.body as { group_id: string };
    const callerUserId = req.userId!;

    const membership = await query<{ role: string }>(
      `SELECT role FROM group_members WHERE group_id = $1 AND user_id = $2`,
      [group_id, callerUserId],
    );
    if (membership.rows.length === 0 || membership.rows[0].role !== 'admin') {
      res.status(403).json({ error: 'Only a group admin can reset the secure key' });
      return;
    }

    const bump = await query<{ group_key_version: number }>(
      `UPDATE groups SET group_key_version = group_key_version + 1
        WHERE id = $1
    RETURNING group_key_version`,
      [group_id],
    );
    const newVersion = bump.rows[0]?.group_key_version;
    if (newVersion === undefined) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    // Tell every member to re-pull the key at the new version. Members whose
    // stored version is lower request recovery and overwrite; the admin's
    // device (which just minted the new key) serves as courier.
    emitToGroup(group_id, 'group:key_rotated', {
      group_id,
      group_key_version: newVersion,
    });

    logger.info('group key reset', { group_key_version: newVersion });
    res.status(200).json({ v: 1, group_key_version: newVersion });
  }),
);

export default router;
