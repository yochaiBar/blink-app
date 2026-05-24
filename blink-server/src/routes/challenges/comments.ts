import { Router, Response } from 'express';
import { query } from '../../config/database';
import { AuthRequest } from '../../middleware/auth';
import { asyncHandler } from '../../middleware/asyncHandler';
import { validateBody } from '../../middleware/validate';
import { validateUuidParams } from '../../middleware/validateParams';
import { createCommentSchema } from '../../utils/schemas';
import { emitToGroup } from '../../socket';
import { sendPushToUser } from '../../services/pushNotifications';
import logger from '../../utils/logger';
import { GroupMemberRow, UserDisplayNameRow } from '../../types/db';

interface CommentRow {
  id: string;
  response_id: string;
  user_id: string;
  parent_comment_id: string | null;
  text: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface ResponseContextRow {
  response_user_id: string;
  challenge_id: string;
  group_id: string;
}

const router = Router();

// Resolves the group/owner context for a response_id in one query.
// Returns null if the response doesn't exist.
async function loadResponseContext(responseId: string): Promise<ResponseContextRow | null> {
  const result = await query<ResponseContextRow>(
    `SELECT cr.user_id AS response_user_id, cr.challenge_id, c.group_id
       FROM challenge_responses cr
       JOIN challenges c ON c.id = cr.challenge_id
      WHERE cr.id = $1`,
    [responseId],
  );
  return result.rows[0] ?? null;
}

async function isGroupMember(groupId: string, userId: string): Promise<boolean> {
  const membership = await query<GroupMemberRow>(
    `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [groupId, userId],
  );
  return membership.rows.length > 0;
}

async function getDisplayName(userId: string): Promise<string> {
  const u = await query<UserDisplayNameRow>(
    `SELECT COALESCE(display_name, phone_number) AS display_name FROM users WHERE id = $1`,
    [userId],
  );
  return u.rows[0]?.display_name || 'Someone';
}

// ── POST /api/challenges/responses/:responseId/comments — Create comment ──
router.post(
  '/responses/:responseId/comments',
  validateUuidParams('responseId'),
  validateBody(createCommentSchema),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const responseId = req.params.responseId as string;
    const { text, parent_comment_id } = req.body as {
      text: string;
      parent_comment_id?: string;
    };

    const context = await loadResponseContext(responseId);
    if (!context) {
      res.status(404).json({ error: 'Response not found' });
      return;
    }

    if (!(await isGroupMember(context.group_id, req.userId!))) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    // If this is a reply, validate the parent: it must exist, must belong to the
    // same response, must not itself be a reply (enforces 1-level threading).
    if (parent_comment_id) {
      const parent = await query<CommentRow>(
        `SELECT id, response_id, parent_comment_id, deleted_at
           FROM response_comments
          WHERE id = $1`,
        [parent_comment_id],
      );
      const parentRow = parent.rows[0];
      if (!parentRow || parentRow.deleted_at) {
        res.status(404).json({ error: 'Parent comment not found' });
        return;
      }
      if (parentRow.response_id !== responseId) {
        res.status(400).json({ error: 'Parent comment belongs to a different response' });
        return;
      }
      if (parentRow.parent_comment_id !== null) {
        res.status(400).json({ error: 'Replies cannot be nested beyond one level' });
        return;
      }
    }

    const insert = await query<CommentRow>(
      `INSERT INTO response_comments (response_id, user_id, parent_comment_id, text)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [responseId, req.userId, parent_comment_id ?? null, text.trim()],
    );
    const comment = insert.rows[0];

    emitToGroup(context.group_id, 'comment:created', {
      response_id: responseId,
      comment,
    });

    // Fire-and-forget push notifications.
    // - Reply: notify the parent comment's author.
    // - Top-level comment: notify the photo owner.
    const commenterName = await getDisplayName(req.userId!);
    if (parent_comment_id) {
      const parentAuthor = await query<{ user_id: string }>(
        `SELECT user_id FROM response_comments WHERE id = $1`,
        [parent_comment_id],
      );
      const parentAuthorId = parentAuthor.rows[0]?.user_id;
      if (parentAuthorId && parentAuthorId !== req.userId) {
        sendPushToUser(
          parentAuthorId,
          'New reply',
          `${commenterName} replied to your comment`,
          {
            type: 'comment_reply',
            response_id: responseId,
            comment_id: comment.id,
            group_id: context.group_id,
          },
        ).catch(() => undefined);
      }
    } else if (context.response_user_id && context.response_user_id !== req.userId) {
      sendPushToUser(
        context.response_user_id,
        'New comment',
        `${commenterName} commented on your photo`,
        {
          type: 'comment',
          response_id: responseId,
          comment_id: comment.id,
          group_id: context.group_id,
        },
      ).catch(() => undefined);
    }

    logger.info('Comment created', {
      commentId: comment.id,
      responseId,
      userId: req.userId,
      isReply: !!parent_comment_id,
    });
    res.status(201).json(comment);
  }),
);

// ── GET /api/challenges/responses/:responseId/comments — List comments ──
// Returns all non-deleted comments for a response. Replies are flat-joined and
// the client groups them by parent_comment_id. Pagination is a Phase 3 concern;
// at v1 volumes a single response will have <50 comments.
router.get(
  '/responses/:responseId/comments',
  validateUuidParams('responseId'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const responseId = req.params.responseId as string;

    const context = await loadResponseContext(responseId);
    if (!context) {
      res.status(404).json({ error: 'Response not found' });
      return;
    }
    if (!(await isGroupMember(context.group_id, req.userId!))) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    const comments = await query(
      `SELECT rc.id, rc.response_id, rc.user_id, rc.parent_comment_id, rc.text,
              rc.created_at, rc.updated_at,
              u.display_name, u.avatar_url
         FROM response_comments rc
         JOIN users u ON u.id = rc.user_id
        WHERE rc.response_id = $1 AND rc.deleted_at IS NULL
        ORDER BY rc.created_at ASC`,
      [responseId],
    );

    res.json(comments.rows);
  }),
);

// ── DELETE /api/challenges/comments/:commentId — Soft-delete own comment ──
router.delete(
  '/comments/:commentId',
  validateUuidParams('commentId'),
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const commentId = req.params.commentId as string;

    // Atomic: only delete if owner, return the row so we know the response_id
    // for the socket emit.
    const update = await query<CommentRow & { group_id: string }>(
      `UPDATE response_comments rc
          SET deleted_at = NOW()
         FROM challenge_responses cr
         JOIN challenges c ON c.id = cr.challenge_id
        WHERE rc.id = $1 AND rc.user_id = $2 AND rc.deleted_at IS NULL
          AND cr.id = rc.response_id
       RETURNING rc.id, rc.response_id, rc.user_id, rc.parent_comment_id,
                 rc.text, rc.created_at, rc.updated_at, rc.deleted_at,
                 c.group_id`,
      [commentId, req.userId],
    );

    if (update.rows.length === 0) {
      // Check whether the comment exists at all — gives a clearer 404 vs 403.
      const exists = await query(
        `SELECT user_id FROM response_comments WHERE id = $1 AND deleted_at IS NULL`,
        [commentId],
      );
      if (exists.rows.length === 0) {
        res.status(404).json({ error: 'Comment not found' });
      } else {
        res.status(403).json({ error: 'Not the comment owner' });
      }
      return;
    }

    const deleted = update.rows[0];
    emitToGroup(deleted.group_id, 'comment:deleted', {
      response_id: deleted.response_id,
      comment_id: deleted.id,
    });

    logger.info('Comment deleted', { commentId, userId: req.userId });
    res.json({ message: 'Comment deleted' });
  }),
);

export default router;
