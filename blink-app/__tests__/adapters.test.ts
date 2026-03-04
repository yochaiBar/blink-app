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
 * - apiSpotlightToUI
 * - apiResponseToSnap
 * - apiMembersToLeaderboard
 * - apiUserToProfile
 */

import './setup';

import {
  apiGroupListToGroup,
  apiMemberToGroupMember,
  apiGroupDetailToGroup,
  apiSpotlightToUI,
  apiResponseToSnap,
  apiMembersToLeaderboard,
  apiUserToProfile,
} from '../utils/adapters';

import type {
  ApiGroupListItem,
  ApiGroupMember,
  ApiGroupDetail,
  ApiSpotlight,
  ApiChallengeResponse,
} from '../types/api';

const DEFAULT_AVATAR = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&h=200&fit=crop';

// ─────────────────────────────────────────────────────────────────
// apiGroupListToGroup
// ─────────────────────────────────────────────────────────────────
describe('apiGroupListToGroup', () => {
  it('should convert a basic API group list item to Group', () => {
    const apiItem: ApiGroupListItem = {
      id: 'group-1',
      name: 'Test Group',
      icon: '🔥',
      category: 'friends',
      invite_code: 'ABCD1234',
      member_count: 5,
      role: 'admin',
      skip_penalty_type: 'wanted_poster',
      has_active_challenge: false,
    };

    const result = apiGroupListToGroup(apiItem);

    expect(result.id).toBe('group-1');
    expect(result.name).toBe('Test Group');
    expect(result.emoji).toBe('🔥');
    expect(result.category).toBe('close_friends'); // 'friends' maps to 'close_friends'
    expect(result.inviteCode).toBe('ABCD1234');
    expect(result.hasActiveChallenge).toBe(false);
    expect(result.challengeEndTime).toBeUndefined();
    expect(result.members).toEqual([]);
  });

  it('should map "friends" category to "close_friends"', () => {
    const apiItem: ApiGroupListItem = {
      id: 'g1', name: 'G', icon: '', category: 'friends',
      invite_code: 'X', member_count: 1, role: 'member',
      skip_penalty_type: 'none',
    };

    expect(apiGroupListToGroup(apiItem).category).toBe('close_friends');
  });

  it('should keep "family" category as-is', () => {
    const apiItem: ApiGroupListItem = {
      id: 'g1', name: 'G', icon: '', category: 'family',
      invite_code: 'X', member_count: 1, role: 'member',
      skip_penalty_type: 'none',
    };

    expect(apiGroupListToGroup(apiItem).category).toBe('family');
  });

  it('should handle active challenge with countdown', () => {
    const futureTime = new Date(Date.now() + 300000).toISOString();
    const apiItem: ApiGroupListItem = {
      id: 'g1', name: 'G', icon: '📸', category: 'friends',
      invite_code: 'X', member_count: 1, role: 'member',
      skip_penalty_type: 'none',
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
      id: 'g1', name: 'G', icon: '', category: 'custom',
      invite_code: 'X', member_count: 1, role: 'member',
      skip_penalty_type: 'none',
    };

    expect(apiGroupListToGroup(apiItem).emoji).toBe('🔥');
  });

  it('should handle undefined has_active_challenge', () => {
    const apiItem: ApiGroupListItem = {
      id: 'g1', name: 'G', icon: '🔥', category: 'work',
      invite_code: 'X', member_count: 1, role: 'member',
      skip_penalty_type: 'none',
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
      avatar_url: 'https://example.com/alice.jpg',
      role: 'admin',
      streak: 7,
      participation_rate: 85,
      total_responses: 42,
      joined_at: '2024-01-01T00:00:00Z',
    };

    const result = apiMemberToGroupMember(member);

    expect(result.id).toBe('user-1');
    expect(result.name).toBe('Alice');
    expect(result.avatar).toBe('https://example.com/alice.jpg');
    expect(result.streak).toBe(7);
    expect(result.isOnline).toBe(false);
    expect(result.totalSnaps).toBe(42);
    expect(result.role).toBe('admin');
  });

  it('should use default values for null display_name and avatar_url', () => {
    const member: ApiGroupMember = {
      user_id: 'user-2',
      display_name: null,
      avatar_url: null,
      role: 'member',
      streak: 0,
      participation_rate: 0,
      total_responses: 0,
      joined_at: '2024-01-01T00:00:00Z',
    };

    const result = apiMemberToGroupMember(member);

    expect(result.name).toBe('User');
    expect(result.avatar).toBe(DEFAULT_AVATAR);
    expect(result.streak).toBe(0);
  });

  it('should handle undefined streak gracefully', () => {
    const member: any = {
      user_id: 'user-3',
      display_name: 'Bob',
      avatar_url: null,
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
    category: 'friends',
    invite_code: 'ABCD1234',
    skip_penalty_type: 'wanted_poster',
    created_by: 'user-1',
    created_at: '2024-01-01T00:00:00Z',
    members: [
      {
        user_id: 'user-1',
        display_name: 'Alice',
        avatar_url: 'https://example.com/alice.jpg',
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
// apiSpotlightToUI
// ─────────────────────────────────────────────────────────────────
describe('apiSpotlightToUI', () => {
  it('should convert spotlight data to UI model', () => {
    const spotlight: ApiSpotlight = {
      id: 'spot-1',
      group_id: 'group-1',
      featured_user_id: 'user-1',
      display_name: 'Alice',
      avatar_url: 'https://example.com/alice.jpg',
      superlative: 'Fastest Responder',
      stats_json: {
        streak: 10,
        total_responses: 50,
        participation_rate: 95,
        fun_fact: 'Always first to respond!',
      },
      date: '2024-01-01',
    };

    const result = apiSpotlightToUI(spotlight);

    expect(result.userId).toBe('user-1');
    expect(result.userName).toBe('Alice');
    expect(result.title).toBe('Fastest Responder');
    expect(result.subtitle).toBe('Always first to respond!');
    expect(result.stats).toHaveLength(3);
    expect(result.stats[0].value).toBe('50');
    expect(result.stats[1].value).toBe('10 days');
    expect(result.stats[2].value).toBe('95%');
  });

  it('should use defaults for null display_name and avatar_url', () => {
    const spotlight: ApiSpotlight = {
      id: 'spot-2',
      group_id: 'group-1',
      featured_user_id: 'user-2',
      display_name: null,
      avatar_url: null,
      superlative: '',
      stats_json: { streak: 0, total_responses: 0, participation_rate: 0, fun_fact: '' },
      date: '2024-01-01',
    };

    const result = apiSpotlightToUI(spotlight);

    expect(result.userName).toBe('User');
    expect(result.userAvatar).toBe(DEFAULT_AVATAR);
    expect(result.title).toBe("Today's Star");
  });

  it('should use default subtitle when fun_fact is empty', () => {
    const spotlight: ApiSpotlight = {
      id: 'spot-3',
      group_id: 'group-1',
      featured_user_id: 'user-3',
      display_name: 'Bob',
      avatar_url: null,
      superlative: 'Test',
      stats_json: { streak: 1, total_responses: 5, participation_rate: 80, fun_fact: '' },
      date: '2024-01-01',
    };

    const result = apiSpotlightToUI(spotlight);
    expect(result.subtitle).toBe('Top performer this week!');
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
      avatar_url: 'https://example.com/alice.jpg',
      photo_url: 'https://example.com/photo.jpg',
      answer_index: null,
      response_time_ms: 3500,
      responded_at: '2024-01-01T12:00:00Z',
      created_at: '2024-01-01T12:00:00Z',
    };

    const result = apiResponseToSnap(response);

    expect(result.id).toBe('resp-1');
    expect(result.userId).toBe('user-1');
    expect(result.userName).toBe('Alice');
    expect(result.imageUrl).toBe('https://example.com/photo.jpg');
    expect(result.timestamp).toBe('2024-01-01T12:00:00Z');
    expect(result.reactions).toEqual([]);
  });

  it('should use defaults for null display_name and photo_url', () => {
    const response: ApiChallengeResponse = {
      id: 'resp-2',
      challenge_id: 'c-1',
      user_id: 'user-2',
      display_name: null,
      avatar_url: null,
      photo_url: null,
      answer_index: 1,
      response_time_ms: null,
      responded_at: '2024-01-01T12:00:00Z',
      created_at: '2024-01-01T12:00:00Z',
    };

    const result = apiResponseToSnap(response);

    expect(result.userName).toBe('User');
    expect(result.userAvatar).toBe(DEFAULT_AVATAR);
    expect(result.imageUrl).toBe('');
  });

  it('should prefer responded_at over created_at for timestamp', () => {
    const response: ApiChallengeResponse = {
      id: 'resp-3',
      challenge_id: 'c-1',
      user_id: 'user-3',
      display_name: 'Bob',
      avatar_url: null,
      photo_url: null,
      answer_index: null,
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
      { user_id: 'u1', display_name: 'Alice', avatar_url: null, role: 'member', streak: 5, participation_rate: 80, total_responses: 10, joined_at: '' },
      { user_id: 'u2', display_name: 'Bob', avatar_url: null, role: 'member', streak: 3, participation_rate: 60, total_responses: 25, joined_at: '' },
      { user_id: 'u3', display_name: 'Charlie', avatar_url: null, role: 'admin', streak: 1, participation_rate: 40, total_responses: 15, joined_at: '' },
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
      { user_id: 'u1', display_name: 'Solo', avatar_url: null, role: 'admin', streak: 0, participation_rate: 0, total_responses: 0, joined_at: '' },
    ];

    const result = apiMembersToLeaderboard(members);
    expect(result).toHaveLength(1);
    expect(result[0].rank).toBe(1);
  });

  it('should handle tied scores correctly', () => {
    const members: ApiGroupMember[] = [
      { user_id: 'u1', display_name: 'A', avatar_url: null, role: 'member', streak: 0, participation_rate: 0, total_responses: 10, joined_at: '' },
      { user_id: 'u2', display_name: 'B', avatar_url: null, role: 'member', streak: 0, participation_rate: 0, total_responses: 10, joined_at: '' },
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
      avatar_url: 'https://example.com/alice.jpg',
      bio: 'Hello world',
    };

    const result = apiUserToProfile(user);

    expect(result.id).toBe('user-1');
    expect(result.name).toBe('Alice');
    expect(result.avatar).toBe('https://example.com/alice.jpg');
    expect(result.bio).toBe('Hello world');
    expect(result.username).toBe('');
    expect(result.notificationsEnabled).toBe(true);
    expect(result.privacyMode).toBe('everyone');
  });

  it('should use defaults for null display_name, avatar_url, and bio', () => {
    const user = {
      id: 'user-2',
      phone_number: '+19995550000',
      display_name: null,
      avatar_url: null,
      bio: null,
    };

    const result = apiUserToProfile(user);

    expect(result.name).toBe('');
    expect(result.avatar).toBe(DEFAULT_AVATAR);
    expect(result.bio).toBe('');
  });

  it('should handle user without bio field', () => {
    const user = {
      id: 'user-3',
      phone_number: '+15551234567',
      display_name: 'Bob',
      avatar_url: null,
    };

    const result = apiUserToProfile(user);
    expect(result.bio).toBe('');
  });

  it('should set totalSnaps, longestStreak, and groupCount to zero', () => {
    const user = {
      id: 'user-1',
      phone_number: '+15551234567',
      display_name: 'Test',
      avatar_url: null,
    };

    const result = apiUserToProfile(user);

    expect(result.totalSnaps).toBe(0);
    expect(result.longestStreak).toBe(0);
    expect(result.groupCount).toBe(0);
  });
});
