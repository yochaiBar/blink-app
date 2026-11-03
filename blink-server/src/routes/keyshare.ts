import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateBody } from '../middleware/validate';
import {
  keyshareConfirmSchema,
  keyshareDeliverSchema,
  keyshareRequestSchema,
  keyshareResetSchema,
} from '../utils/schemas';
import { requireMember } from '../services/membership';
import { confirmGroupKey, deliverKeyshare, requestKeyshareRecovery, resetGroupKey } from '../services/keyshareHub';
import type {
  KeyshareConfirmRequest,
  KeyshareConfirmResult,
  KeyshareDeliverRequest,
  KeyshareDeliverResult,
  KeyshareRecoveryRequest,
  KeyshareRecoveryResult,
  KeyshareResetRequest,
  KeyshareResetResult,
} from '../shared/photoProtocol';

// Group-key courier handshake (protocol v2). The rules live in
// services/keyshareHub; these routes validate, authorize membership and
// translate. The server never sees a group key.

const router = Router();
router.use(authenticate);

// POST /api/keyshare/deliver — the claiming courier hands over an envelope
// for the joiner's device (403 for anyone else, 409 at a stale version).
router.post(
  '/deliver',
  validateBody(keyshareDeliverSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    await deliverKeyshare(req.userId!, req.body as KeyshareDeliverRequest);
    const result: KeyshareDeliverResult = { v: 2, delivered: true };
    res.json(result);
  }),
);

// POST /api/keyshare/request — a member asks for the key on this device.
router.post(
  '/request',
  validateBody(keyshareRequestSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { group_id, device_id } = req.body as KeyshareRecoveryRequest;
    await requireMember(req.userId!, { groupId: group_id });
    const outcome = await requestKeyshareRecovery({
      groupId: group_id,
      requesterUserId: req.userId!,
      requesterDeviceId: device_id,
    });
    const result: KeyshareRecoveryResult = {
      v: 2,
      enqueued: outcome.enqueued,
      couriers_notified: outcome.couriersNotified,
    };
    res.json(result);
  }),
);

// POST /api/keyshare/confirm — this member's device holds the current key.
router.post(
  '/confirm',
  validateBody(keyshareConfirmSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { group_id, key_version } = req.body as KeyshareConfirmRequest;
    await requireMember(req.userId!, { groupId: group_id });
    await confirmGroupKey(req.userId!, group_id, key_version);
    const result: KeyshareConfirmResult = { v: 2, key_version };
    res.json(result);
  }),
);

// POST /api/keyshare/reset — admin only, step one of a key reset; the
// admin's /confirm at the returned version completes it.
router.post(
  '/reset',
  validateBody(keyshareResetSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { group_id } = req.body as KeyshareResetRequest;
    const groupKeyVersion = await resetGroupKey(req.userId!, group_id);
    const result: KeyshareResetResult = { v: 2, group_key_version: groupKeyVersion };
    res.json(result);
  }),
);

export default router;
