import { Router, Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { validateBody } from '../../middleware/validate';
import { createChallengeSchema } from '../../utils/schemas';
import { uuidParams } from '../../middleware/params';
import { requireMember } from '../../services/membership';
import { createChallenge } from '../../services/challengeLifecycle';

const router = Router();
uuidParams(router, 'groupId');

// ── POST /api/challenges/groups/:groupId/challenges -- Start a snap challenge ──
router.post(
  '/groups/:groupId/challenges',
  validateBody(createChallengeSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const groupId = req.params.groupId as string;
    await requireMember(req.userId!, { groupId });
    const challenge = await createChallenge({ groupId, createdBy: req.userId! });
    res.status(201).json(challenge);
  }),
);

export default router;
