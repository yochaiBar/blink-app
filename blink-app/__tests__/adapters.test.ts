/**
 * Adapter Tests - blink-app
 *
 * Tests all data transformation functions that convert API responses
 * to the UI data models used throughout the app.
 *
 * Covers:
 * - apiGroupListToGroup
 * - apiMemberToGroupMember
 * - apiGroupDetailToGroup
 * - apiResponseToSnap
 * - apiMembersToLeaderboard
 * - apiUserToProfile
 */

import './setup';

import {
  apiGroupListToGroup,
  apiMemberToGroupMember,
  apiGroupDetailToGroup,
  apiResponseToSnap,
  apiMembersToLeaderboard,
  apiUserToProfile,
} from '../utils/adapters';

import type { ApiGroupListItem, ApiGroupMember, ApiGroupDetail, ApiChallengeResponse } from '../types/api';

// ─────────────────────────────────────────────────────────────────
// apiGroupListToGroup
// ─────────────────────────────────────────────────────────────────
describe('apiGroupListToGroup', () => {
  it('should convert a basic API group list item to Group', () => {
    const apiItem: ApiGroupListItem = {
      id: 'group-1',
      name: 'Test Group',
      icon: '🔥',
      invite_code: 'ABCD1234',
      member_count: 5,
      role: 'admin',
      has_active_challenge: false,
    };

    const result = apiGroupListToGroup(apiItem);

    expect(result.id).toBe('group-1');
    expect(result.name).toBe('Test Group');
    expect(result.emoji).toBe('🔥');
    expect(result.inviteCode).toBe('ABCD1234');
    expect(result.hasActiveChallenge).toBe(false);
    expect(result.challengeEndTime).toBeUndefined();
    expect(result.members).toEqual([]);
  });

  it('should handle active challenge with countdown', () => {
    const futureTime = new Date(Date.now() + 300000).toISOString();
    const apiItem: ApiGroupListItem = {
      id: 'g1',
      name: 'G',
      icon: '📸',
      invite_code: 'X',
      member_count: 1,
      role: 'member',
      has_active_challenge: true,
      challenge_expires_at: futureTime,
    };

    const result = apiGroupListToGroup(apiItem);
    expect(result.hasActiveChallenge).toBe(true);
    expect(result.challengeEndTime).toBeDefined();
    expect(result.challengeEndTime).toBeGreaterThan(Date.now());
  });

  it('should default icon to fire emoji when missing', () => {
    const apiItem: ApiGroupListItem = {
      id: 'g1',
      name: 'G',
      icon: '',
      invite_code: 'X',
      member_count: 1,
      role: 'member',
    };

    expect(apiGroupListToGroup(apiItem).emoji).toBe('🔥');
  });

  it('should handle undefined has_active_challenge', () => {
    const apiItem: ApiGroupListItem = {
      id: 'g1',
      name: 'G',
      icon: '🔥',
      invite_code: 'X',
      member_count: 1,
      role: 'member',
    };

    const result = apiGroupListToGroup(apiItem);
    expect(result.hasActiveChallenge).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────
// apiMemberToGroupMember
// ─────────────────────────────────────────────────────────────────
describe('apiMemberToGroupMember', () => {
  it('should convert API member to GroupMember', () => {
    const member: ApiGroupMember = {
      user_id: 'user-1',
      display_name: 'Alice',
      role: 'admin',
      streak: 7,
      participation_rate: 85,
      total_responses: 42,
      joined_at: '2024-01-01T00:00:00Z',
    };

    const result = apiMemberToGroupMember(member);

    expect(result.id).toBe('user-1');
    expect(result.name).toBe('Alice');
    expect(result.streak).toBe(7);
    expect(result.isOnline).toBe(false);
    expect(result.totalSnaps).toBe(42);
    expect(result.role).toBe('admin');
  });

  it('should use default values for null display_name', () => {
    const member: ApiGroupMember = {
      user_id: 'user-2',
      display_name: null,
      role: 'member',
      streak: 0,
      participation_rate: 0,
      total_responses: 0,
      joined_at: '2024-01-01T00:00:00Z',
    };

    const result = apiMemberToGroupMember(member);

    expect(result.name).toBe('User');
    expect(result.streak).toBe(0);
  });

  it('should handle undefined streak gracefully', () => {
    const member: any = {
      user_id: 'user-3',
      display_name: 'Bob',
      role: 'member',
      streak: undefined,
      participation_rate: 0,
      total_responses: 5,
      joined_at: '2024-01-01T00:00:00Z',
    };

    const result = apiMemberToGroupMember(member);
    expect(result.streak).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────
// apiGroupDetailToGroup
// ─────────────────────────────────────────────────────────────────
describe('apiGroupDetailToGroup', () => {
  const baseDetail: ApiGroupDetail = {
    id: 'group-1',
    name: 'Test Group',
    icon: '🔥',
    invite_code: 'ABCD1234',
    created_by: 'user-1',
    created_at: '2024-01-01T00:00:00Z',
    members: [
      {
        user_id: 'user-1',
        display_name: 'Alice',
        role: 'admin',
        streak: 5,
        participation_rate: 90,
        total_responses: 30,
        joined_at: '2024-01-01T00:00:00Z',
      },
    ],
  };

  it('should convert detailed group with members', () => {
    const result = apiGroupDetailToGroup(baseDetail);

    expect(result.id).toBe('group-1');
    expect(result.name).toBe('Test Group');
    expect(result.members).toHaveLength(1);
    expect(result.members[0].name).toBe('Alice');
    expect(result.hasActiveChallenge).toBe(false);
    expect(result.createdBy).toBe('user-1');
  });

  it('should include active challenge info when provided', () => {
    const activeChallenge = { expires_at: new Date(Date.now() + 300000).toISOString() };
    const result = apiGroupDetailToGroup(baseDetail, activeChallenge);

    expect(result.hasActiveChallenge).toBe(true);
    expect(result.challengeEndTime).toBeDefined();
  });

  it('should handle null active challenge', () => {
    const result = apiGroupDetailToGroup(baseDetail, null);

    expect(result.hasActiveChallenge).toBe(false);
    expect(result.challengeEndTime).toBeUndefined();
  });

  it('should handle empty members array', () => {
    const detail = { ...baseDetail, members: [] };
    const result = apiGroupDetailToGroup(detail);

    expect(result.members).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────
// apiResponseToSnap
// ─────────────────────────────────────────────────────────────────
describe('apiResponseToSnap', () => {
  it('should convert challenge response to SnapSubmission', () => {
    const response: ApiChallengeResponse = {
      id: 'resp-1',
      challenge_id: 'challenge-1',
      user_id: 'user-1',
      display_name: 'Alice',
      response_time_ms: 3500,
      responded_at: '2024-01-01T12:00:00Z',
      created_at: '2024-01-01T12:00:00Z',
    };

    const result = apiResponseToSnap(response);

    expect(result.id).toBe('resp-1');
    expect(result.userId).toBe('user-1');
    expect(result.userName).toBe('Alice');
    expect(result.timestamp).toBe('2024-01-01T12:00:00Z');
    expect(result.reactions).toEqual([]);
  });

  it('should use defaults for null display_name', () => {
    const response: ApiChallengeResponse = {
      id: 'resp-2',
      challenge_id: 'c-1',
      user_id: 'user-2',
      display_name: null,
      response_time_ms: null,
      responded_at: '2024-01-01T12:00:00Z',
      created_at: '2024-01-01T12:00:00Z',
    };

    const result = apiResponseToSnap(response);

    expect(result.userName).toBe('User');
  });

  it('should prefer responded_at over created_at for timestamp', () => {
    const response: ApiChallengeResponse = {
      id: 'resp-3',
      challenge_id: 'c-1',
      user_id: 'user-3',
      display_name: 'Bob',
      response_time_ms: null,
      responded_at: '2024-06-15T10:00:00Z',
      created_at: '2024-06-15T09:59:00Z',
    };

    const result = apiResponseToSnap(response);
    expect(result.timestamp).toBe('2024-06-15T10:00:00Z');
  });
});

// ─────────────────────────────────────────────────────────────────
// apiMembersToLeaderboard
// ─────────────────────────────────────────────────────────────────
describe('apiMembersToLeaderboard', () => {
  it('should sort members by total_responses descending and assign ranks', () => {
    const members: ApiGroupMember[] = [
      {
        user_id: 'u1',
        display_name: 'Alice',
        role: 'member',
        streak: 5,
        participation_rate: 80,
        total_responses: 10,
        joined_at: '',
      },
      {
        user_id: 'u2',
        display_name: 'Bob',
        role: 'member',
        streak: 3,
        participation_rate: 60,
        total_responses: 25,
        joined_at: '',
      },
      {
        user_id: 'u3',
        display_name: 'Charlie',
        role: 'admin',
        streak: 1,
        participation_rate: 40,
        total_responses: 15,
        joined_at: '',
      },
    ];

    const result = apiMembersToLeaderboard(members);

    expect(result).toHaveLength(3);
    expect(result[0].userName).toBe('Bob');
    expect(result[0].rank).toBe(1);
    expect(result[0].score).toBe(25);
    expect(result[1].userName).toBe('Charlie');
    expect(result[1].rank).toBe(2);
    expect(result[2].userName).toBe('Alice');
    expect(result[2].rank).toBe(3);
  });

  it('should handle empty members array', () => {
    const result = apiMembersToLeaderboard([]);
    expect(result).toEqual([]);
  });

  it('should handle single member', () => {
    const members: ApiGroupMember[] = [
      {
        user_id: 'u1',
        display_name: 'Solo',
        role: 'admin',
        streak: 0,
        participation_rate: 0,
        total_responses: 0,
        joined_at: '',
      },
    ];

    const result = apiMembersToLeaderboard(members);
    expect(result).toHaveLength(1);
    expect(result[0].rank).toBe(1);
  });

  it('should handle tied scores correctly', () => {
    const members: ApiGroupMember[] = [
      {
        user_id: 'u1',
        display_name: 'A',
        role: 'member',
        streak: 0,
        participation_rate: 0,
        total_responses: 10,
        joined_at: '',
      },
      {
        user_id: 'u2',
        display_name: 'B',
        role: 'member',
        streak: 0,
        participation_rate: 0,
        total_responses: 10,
        joined_at: '',
      },
    ];

    const result = apiMembersToLeaderboard(members);
    expect(result[0].rank).toBe(1);
    expect(result[1].rank).toBe(2); // sequential ranks even with ties
  });
});

// ─────────────────────────────────────────────────────────────────
// apiUserToProfile
// ─────────────────────────────────────────────────────────────────
describe('apiUserToProfile', () => {
  it('should convert API user to UserProfile', () => {
    const user = {
      id: 'user-1',
      phone_number: '+15551234567',
      display_name: 'Alice',
      bio: 'Hello world',
    };

    const result = apiUserToProfile(user);

    expect(result.id).toBe('user-1');
    expect(result.name).toBe('Alice');
    expect(result.bio).toBe('Hello world');
  });

  it('should use defaults for null display_name and bio', () => {
    const user = {
      id: 'user-2',
      phone_number: '+19995550000',
      display_name: null,
      bio: null,
    };

    const result = apiUserToProfile(user);

    expect(result.name).toBe('');
    expect(result.bio).toBe('');
  });

  it('should handle user without bio field', () => {
    const user = {
      id: 'user-3',
      phone_number: '+15551234567',
      display_name: 'Bob',
    };

    const result = apiUserToProfile(user);
    expect(result.bio).toBe('');
  });

  it('should set totalSnaps, longestStreak, and groupCount to zero', () => {
    const user = {
      id: 'user-1',
      phone_number: '+15551234567',
      display_name: 'Test',
    };

    const result = apiUserToProfile(user);

    expect(result.totalSnaps).toBe(0);
    expect(result.longestStreak).toBe(0);
    expect(result.groupCount).toBe(0);
  });
});
