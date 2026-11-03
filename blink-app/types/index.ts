export interface GroupMember {
  id: string;
  name: string;
  avatar: string;
  streak: number;
  isOnline: boolean;
  totalSnaps?: number;
  totalReactions?: number;
  role?: string;
}

export interface Group {
  id: string;
  name: string;
  emoji: string;
  members: GroupMember[];
  memberCount?: number;
  lastActive: string;
  hasActiveChallenge: boolean;
  challengeDeadline?: string;
  challengeEndTime?: number;
  color: string;
  inviteCode: string;
  createdAt: string;
  createdBy?: string;
  /** This user's role in the group ('admin' | 'member'). */
  role?: string;
  /** Server-tracked group key version (bumped on admin key reset). */
  groupKeyVersion?: number;
}

export interface SnapSubmission {
  id: string;
  userId: string;
  userName: string;
  userAvatar: string;
  groupId: string;
  imageUrl: string;
  timestamp: string;
  reactions: Reaction[];
  encryptionMetadata?: {
    v: number;
    alg: string;
    iv: string;
    tag: string;
    key_enc: string;
  } | null;
}

export interface Reaction {
  emoji: string;
  count: number;
  userIds: string[];
}

export interface UserProfile {
  id: string;
  name: string;
  username: string;
  avatar: string;
  bio: string;
  totalSnaps: number;
  longestStreak: number;
  groupCount: number;
  joinDate: string;
  notificationsEnabled: boolean;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  privacyMode: 'everyone' | 'friends' | 'groups_only';
}

export interface NotificationItem {
  id: string;
  type: 'challenge' | 'reaction' | 'streak' | 'join' | 'invite' | 'system' | string;
  title: string;
  body: string;
  timestamp: string;
  read: boolean;
  groupId?: string;
  groupName?: string;
  fromUserAvatar?: string;
}

export interface LeaderboardEntry {
  userId: string;
  userName: string;
  userAvatar: string;
  score: number;
  streak: number;
  rank: number;
}

export interface AppSettings {
  notificationsEnabled: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
  privacyMode: 'everyone' | 'friends' | 'groups_only';
}
