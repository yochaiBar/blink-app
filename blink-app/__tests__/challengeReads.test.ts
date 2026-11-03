/**
 * challengeReads — progress / preview derived from GET /challenges/:id, and
 * the client-side blur rule that replaced the server's reveal gate.
 */

import './setup';

import { isOpen, previewOf, progressOf, shouldBlurOthers } from '../services/challengeReads';
import type { ApiChallengeDetail } from '../types/api';

const NOW = Date.parse('2026-11-03T12:00:00Z');
const inAMinute = new Date(NOW + 60_000).toISOString();
const aMinuteAgo = new Date(NOW - 60_000).toISOString();

const response = (userId: string, name: string | null, reactions: { emoji: string; count: number }[] = []) => ({
  id: `r-${userId}`,
  challenge_id: 'c1',
  user_id: userId,
  display_name: name,
  has_photo: true,
  response_time_ms: 1200,
  responded_at: aMinuteAgo,
  reactions,
});

const challenge = (overrides: Partial<ApiChallengeDetail> = {}): ApiChallengeDetail => ({
  id: 'c1',
  group_id: 'g1',
  group_name: 'Crew',
  group_emoji: '🔥',
  prompt: null,
  created_by: null,
  created_at: aMinuteAgo,
  expires_at: inAMinute,
  status: 'active',
  member_count: 4,
  response_count: 2,
  user_has_responded: false,
  responses: [
    response('u1', 'Dana', [
      { emoji: '🔥', count: 2 },
      { emoji: '😂', count: 1 },
    ]),
    response('u2', null, [{ emoji: '😂', count: 3 }]),
  ],
  ...overrides,
});

describe('challengeReads', () => {
  it('derives who answered and the teaser numbers', () => {
    expect(progressOf(challenge())).toEqual({
      respondedCount: 2,
      totalMembers: 4,
      respondedUsers: [
        { userId: 'u1', displayName: 'Dana' },
        { userId: 'u2', displayName: 'New member' },
      ],
    });
    expect(previewOf(challenge())).toMatchObject({ respondedCount: 2, totalReactions: 6, topReactionEmoji: '😂' });
    expect(previewOf(challenge({ responses: [] }))).toMatchObject({ totalReactions: 0, topReactionEmoji: undefined });
  });

  it('blurs others’ photos only on an open challenge you haven’t answered', () => {
    expect(shouldBlurOthers(challenge(), NOW)).toBe(true);
    expect(shouldBlurOthers(challenge({ user_has_responded: true }), NOW)).toBe(false);
    expect(shouldBlurOthers(challenge({ status: 'completed' }), NOW)).toBe(false);
    // Past its window but not finalized yet: closed for the viewer.
    expect(shouldBlurOthers(challenge({ expires_at: aMinuteAgo }), NOW)).toBe(false);
    expect(isOpen(challenge({ expires_at: aMinuteAgo }), NOW)).toBe(false);
  });
});
