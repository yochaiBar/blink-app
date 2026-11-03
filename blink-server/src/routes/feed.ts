import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { asyncHandler } from '../middleware/asyncHandler';
import { validateQuery, parsedQuery } from '../middleware/validate';
import { paginationQuerySchema, PaginationQuery } from '../utils/schemas';
import { listChallenges, loadResponses } from '../services/challengeReads';

const router = Router();
router.use(authenticate);

// ── GET /api/feed -- Home: challenges across the caller's groups, newest first ──
// Each item carries its visible responses, loaded in one query for the whole
// page. Cursor pagination: pass `next_before` back as `before`.
router.get(
  '/',
  validateQuery(paginationQuerySchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { limit, before } = parsedQuery<PaginationQuery>(res);
    const challenges = await listChallenges(
      `c.group_id IN (SELECT group_id FROM group_members WHERE user_id = $1)
       AND ($2::timestamptz IS NULL OR c.created_at < $2::timestamptz)`,
      [before ?? null],
      req.userId!,
      limit,
    );
    const responses = await loadResponses(
      challenges.map((c) => c.id),
      req.userId!,
    );
    const items = challenges.map((c) => ({ ...c, responses: responses.get(c.id) ?? [] }));
    const last = challenges[challenges.length - 1];
    res.json({
      items,
      next_before: challenges.length === limit && last ? new Date(last.created_at).toISOString() : null,
    });
  }),
);

export default router;
