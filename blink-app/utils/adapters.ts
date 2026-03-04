import { Group, GroupMember, UserProfile, DailySpotlight, SnapSubmission, LeaderboardEntry } from '@/types';
import { ApiGroupListItem, ApiGroupDetail, ApiGroupMember, ApiSpotlight, ApiChallengeResponse } from '@/types/api';
import { theme } from '@/constants/colors';

const DEFAULT_AVATAR = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&h=200&fit=crop';

const categoryColorMap: Record<string, string> = {
  close_friends: theme.coral,
  friends: theme.coral,
  family: theme.yellow,
  students: theme.blue,
  work: theme.green,
  custom: theme.purple,
};

export function apiGroupListToGroup(item: ApiGroupListItem): Group {
  const cat = item.category === 'friends' ? 'close_friends' : item.category;
  const hasActive = item.has_active_challenge ?? false;
  const endTime = item.challenge_expires_at ? new Date(item.challenge_expires_at).getTime() : undefined;
  return {
    id: item.id,
    name: item.name,
    category: (cat as Group['category']) || 'custom',
    emoji: item.icon || '🔥',
    members: [],
    lastActive: item.challenge_expires_at ?? new Date().toISOString(),
    hasActiveChallenge: hasActive,
    challengeEndTime: hasActive ? endTime : undefined,
    color: categoryColorMap[item.category] ?? theme.coral,
    inviteCode: item.invite_code,
    createdAt: new Date().toISOString(),
  };
}

export function apiMemberToGroupMember(m: ApiGroupMember): GroupMember {
  return {
    id: m.user_id,
    name: m.display_name ?? 'User',
    avatar: m.avatar_url ?? DEFAULT_AVATAR,
    streak: m.streak ?? 0,
    isOnline: false,
    totalSnaps: m.total_responses ?? 0,
    totalReactions: 0,
    role: m.role,
  };
}

export function apiGroupDetailToGroup(detail: ApiGroupDetail, activeChallenge?: { expires_at: string } | null): Group {
  const cat = detail.category === 'friends' ? 'close_friends' : detail.category;
  const members = detail.members.map(apiMemberToGroupMember);
  const hasActive = !!activeChallenge;
  const endTime = activeChallenge ? new Date(activeChallenge.expires_at).getTime() : undefined;

  return {
    id: detail.id,
    name: detail.name,
    category: (cat as Group['category']) || 'custom',
    emoji: detail.icon || '🔥',
    members,
    lastActive: detail.created_at,
    hasActiveChallenge: hasActive,
    challengeEndTime: endTime,
    color: categoryColorMap[detail.category] ?? theme.coral,
    inviteCode: detail.invite_code,
    createdAt: detail.created_at,
    createdBy: detail.created_by,
  };
}

export function apiSpotlightToUI(s: ApiSpotlight, groupId?: string): DailySpotlight {
  const stats = s.stats_json;
  return {
    userId: s.featured_user_id,
    userName: s.display_name ?? 'User',
    userAvatar: s.avatar_url ?? DEFAULT_AVATAR,
    groupId: groupId ?? s.group_id ?? '',
    title: s.superlative || "Today's Star",
    subtitle: stats.fun_fact || 'Top performer this week!',
    stats: [
      { label: 'Responses', value: String(stats.total_responses), emoji: '📸' },
      { label: 'Streak', value: `${stats.streak} days`, emoji: '🔥' },
      { label: 'Rate', value: `${stats.participation_rate}%`, emoji: '🎯' },
    ],
  };
}

export function apiResponseToSnap(r: ApiChallengeResponse): SnapSubmission {
  return {
    id: r.id,
    userId: r.user_id,
    userName: r.display_name ?? 'User',
    userAvatar: r.avatar_url ?? DEFAULT_AVATAR,
    groupId: '',
    imageUrl: r.photo_url ?? '',
    timestamp: r.responded_at ?? r.created_at,
    reactions: [],
  };
}

export function apiMembersToLeaderboard(members: ApiGroupMember[]): LeaderboardEntry[] {
  return members
    .sort((a, b) => b.total_responses - a.total_responses)
    .map((m, i) => ({
      userId: m.user_id,
      userName: m.display_name ?? 'User',
      userAvatar: m.avatar_url ?? DEFAULT_AVATAR,
      score: m.total_responses,
      streak: m.streak ?? 0,
      rank: i + 1,
    }));
}

export function apiUserToProfile(user: { id: string; phone_number: string; display_name: string | null; avatar_url: string | null; bio?: string | null }): UserProfile {
  return {
    id: user.id,
    name: user.display_name ?? '',
    username: '',
    avatar: user.avatar_url ?? DEFAULT_AVATAR,
    bio: user.bio ?? '',
    totalSnaps: 0,
    longestStreak: 0,
    groupCount: 0,
    joinDate: new Date().toISOString(),
    notificationsEnabled: true,
    privacyMode: 'everyone',
  };
}
