import { Router, Response } from 'express';
import { query } from '../../config/database';
import { AuthRequest } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { uuidParams } from '../../middleware/params';
import { requireMember } from '../../services/membership';
import { validateQuery, parsedQuery } from '../../middleware/validate';
import { paginationQuerySchema, PaginationQuery } from '../../utils/schemas';
import { CHALLENGE_SELECT } from './shared';
import { ChallengeResponseRow } from '../../types/db';
import { listChallenges, loadResponses } from '../../services/challengeReads';
import { HttpError } from '../../utils/httpError';

const router = Router();
uuidParams(router, 'groupId', 'id');

// ── GET active challenge ──
router.get(
  '/groups/:groupId/challenges/active',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const groupId = req.params.groupId as string;

    await requireMember(req.userId!, { groupId });

    // Read-only: the expiry job finalizes challenges, never a GET. The
    // latest challenge still inside its window, whatever its status.
    const result = await query(
      `SELECT ${CHALLENGE_SELECT} FROM challenges
     WHERE group_id = $1 AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
      [groupId],
    );

    if (result.rows.length === 0) {
      res.json(null);
      return;
    }

    const challenge = result.rows[0];

    const userResponse = await query<Pick<ChallengeResponseRow, 'id'>>(
      `SELECT id FROM challenge_responses WHERE challenge_id = $1 AND user_id = $2`,
      [challenge.id, req.userId],
    );

    res.json({
      ...challenge,
      user_has_responded: userResponse.rows.length > 0,
    });
  }),
);

// ── GET /api/challenges/:id — one challenge with its visible responses ──
router.get(
  '/:id',
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const id = req.params.id as string;
    await requireMember(req.userId!, { challengeId: id });

    const [challenge] = await listChallenges('c.id = $3', [id], req.userId!, 1);
    if (!challenge) throw new HttpError(404, 'Challenge not found');
    const responses = await loadResponses([id], req.userId!);
    res.json({ ...challenge, responses: responses.get(id) ?? [] });
  }),
);

// ── GET group photo timeline ──
router.get(
  '/groups/:groupId/photos',
  validateQuery(paginationQuerySchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const groupId = req.params.groupId as string;
    const { limit, before } = parsedQuery<PaginationQuery>(res);

    await requireMember(req.userId!, { groupId });

    const result = await query(
      `SELECT cr.id, cr.challenge_id, cr.has_photo, cr.responded_at,
       c.prompt,
       u.display_name
     FROM challenge_responses cr
     JOIN challenges c ON c.id = cr.challenge_id
     JOIN public_users u ON u.id = cr.user_id
     WHERE c.group_id = $1 AND cr.has_photo = TRUE AND NOT blocked_between(cr.user_id, $3)
       AND ($4::timestamptz IS NULL OR cr.responded_at < $4::timestamptz)
     ORDER BY cr.responded_at DESC
     LIMIT $2`,
      [groupId, limit, req.userId, before ?? null],
    );

    res.json(result.rows);
  }),
);

export default router;
