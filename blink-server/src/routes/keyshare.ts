import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody } from '../middleware/validate';
import { keyshareDeliverSchema } from '../utils/schemas';
import { query } from '../config/database';
import { markKeyshareDelivered } from '../services/keyshareHub';
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

export default router;
