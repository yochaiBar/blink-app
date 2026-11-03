import { Router, Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { validateBody } from '../../middleware/validate';
import { respondChallengeSchema } from '../../utils/schemas';
import { uuidParams } from '../../middleware/params';
import { respondToChallenge } from '../../services/challengeLifecycle';

const router = Router();
uuidParams(router, 'id');

// ── POST /api/challenges/:id/respond ──
// has_photo is the client's signal that bytes will arrive via
// /api/photos/relay separately — the response row never holds a photo.
// The response time is measured by the server.
router.post(
  '/:id/respond',
  validateBody(respondChallengeSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { response } = await respondToChallenge(req.params.id as string, req.userId!, req.body.has_photo === true);
    res.status(201).json(response);
  }),
);

export default router;
