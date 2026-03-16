export type GroupCategory = 'close_friends' | 'family' | 'students' | 'work' | 'custom';

export type AiPersonality = 'family_friendly' | 'funny' | 'spicy' | 'sarcastic' | 'motivational' | 'extreme' | 'sexy' | 'no_filter';

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
  category: GroupCategory;
  emoji: string;
  members: GroupMember[];
  memberCount?: number;
  lastActive: string;
  hasActiveChallenge: boolean;
  challengeDeadline?: string;
  challengeEndTime?: number;
  color: string;
  inviteCode: string;
  activePrompt?: PromptQuestion;
  createdAt: string;
  createdBy?: string;
  aiPersonality?: AiPersonality;
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
}

export interface Reaction {
  emoji: string;
  count: number;
  userIds: string[];
}

export interface DailySpotlight {
  userId: string;
  userName: string;
  userAvatar: string;
  groupId: string;
  title: string;
  subtitle: string;
  stats: SpotlightStat[];
}

export interface SpotlightStat {
  label: string;
  value: string;
  emoji: string;
}

export interface ActivityItem {
  id: string;
  type: 'snap' | 'join' | 'spotlight' | 'quiz' | 'prompt' | 'reaction' | 'streak' | 'challenge_triggered';
  userId: string;
  userName: string;
  userAvatar: string;
  groupName: string;
  groupId: string;
  message: string;
  timestamp: string;
  imageUrl?: string;
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

export interface PromptQuestion {
  id: string;
  groupId: string;
  question: string;
  options?: string[];
  type: 'poll' | 'open' | 'quiz';
  correctAnswer?: number;
}

export interface PromptResponse {
  id: string;
  promptId: string;
  userId: string;
  userName: string;
  userAvatar: string;
  answer: string;
  selectedOption?: number;
  timestamp: string;
}

export interface NotificationItem {
  id: string;
  type: 'challenge' | 'reaction' | 'prompt' | 'streak' | 'join' | 'spotlight' | 'invite' | 'system' | string;
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
