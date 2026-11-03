export interface GroupMember {
  id: string;
  name: string;
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
  groupId: string;
  timestamp: string;
  reactions: Reaction[];
}

export interface Reaction {
  emoji: string;
  count: number;
  userIds: string[];
}

export interface UserProfile {
  id: string;
  name: string;
  bio: string;
  totalSnaps: number;
  longestStreak: number;
  groupCount: number;
  joinDate: string;
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
}

export interface LeaderboardEntry {
  userId: string;
  userName: string;
  score: number;
  streak: number;
  rank: number;
}
