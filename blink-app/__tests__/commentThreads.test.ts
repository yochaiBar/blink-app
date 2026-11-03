import './setup';

import { toThreads } from '../utils/commentThreads';
import type { CommentItem } from '../services/api';

const comment = (id: string, parent: string | null = null): CommentItem => ({
  id,
  response_id: 'r1',
  user_id: 'u1',
  parent_comment_id: parent,
  text: id,
  created_at: '2026-11-03T12:00:00Z',
  updated_at: '2026-11-03T12:00:00Z',
  display_name: 'Dana',
});

describe('toThreads', () => {
  it('keeps top-level order and gathers each reply under its parent', () => {
    const threads = toThreads([comment('a'), comment('b'), comment('a1', 'a'), comment('b1', 'b'), comment('a2', 'a')]);

    expect(threads.map((t) => [t.comment.id, t.replies.map((r) => r.id)])).toEqual([
      ['a', ['a1', 'a2']],
      ['b', ['b1']],
    ]);
  });

  it('drops replies whose parent is gone (e.g. deleted)', () => {
    expect(toThreads([comment('x1', 'x'), comment('y')]).map((t) => t.comment.id)).toEqual(['y']);
  });
});
