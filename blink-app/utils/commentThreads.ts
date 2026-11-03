import type { CommentItem } from '@/services/api';

export interface CommentThread {
  comment: CommentItem;
  replies: CommentItem[];
}

/** Top-level comments in order, each with its replies (one level deep, as the server allows). */
export function toThreads(comments: CommentItem[]): CommentThread[] {
  const replies = new Map<string, CommentItem[]>();
  for (const c of comments) {
    if (c.parent_comment_id) replies.set(c.parent_comment_id, [...(replies.get(c.parent_comment_id) ?? []), c]);
  }
  return comments.filter((c) => !c.parent_comment_id).map((c) => ({ comment: c, replies: replies.get(c.id) ?? [] }));
}
