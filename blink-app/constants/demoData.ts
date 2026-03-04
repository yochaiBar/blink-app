import { Group, GroupMember } from '@/types';
import { ApiGroupDetail, ApiChallenge, ApiChallengeResponse } from '@/types/api';
import { theme } from '@/constants/colors';

export const DEMO_GROUP_ID = 'demo_welcome_crew';

const DEMO_MEMBERS: GroupMember[] = [
  {
    id: 'demo_user_1',
    name: 'Alex',
    avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop',
    streak: 5,
    isOnline: true,
    totalSnaps: 12,
    totalReactions: 8,
  },
  {
    id: 'demo_user_2',
    name: 'Jordan',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop',
    streak: 3,
    isOnline: true,
    totalSnaps: 9,
    totalReactions: 6,
  },
  {
    id: 'demo_user_3',
    name: 'Sam',
    avatar: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&h=200&fit=crop',
    streak: 7,
    isOnline: false,
    totalSnaps: 15,
    totalReactions: 11,
  },
  {
    id: 'demo_user_4',
    name: 'Riley',
    avatar: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&h=200&fit=crop',
    streak: 2,
    isOnline: false,
    totalSnaps: 6,
    totalReactions: 4,
  },
];

export const DEMO_GROUP: Group = {
  id: DEMO_GROUP_ID,
  name: 'Welcome Crew',
  category: 'close_friends',
  emoji: '🎉',
  members: DEMO_MEMBERS,
  lastActive: new Date().toISOString(),
  hasActiveChallenge: true,
  challengeEndTime: Date.now() + 30 * 60 * 1000, // 30 min from now
  color: theme.coral,
  inviteCode: 'DEMO00',
  createdAt: new Date().toISOString(),
};

export const DEMO_GROUP_DETAIL: ApiGroupDetail = {
  id: DEMO_GROUP_ID,
  name: 'Welcome Crew',
  icon: '🎉',
  category: 'friends',
  invite_code: 'DEMO00',
  skip_penalty_type: 'none',
  created_by: 'demo_user_1',
  created_at: new Date().toISOString(),
  members: [
    {
      user_id: 'demo_user_1',
      display_name: 'Alex',
      avatar_url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop',
      role: 'admin',
      streak: 5,
      participation_rate: 0.9,
      total_responses: 12,
      joined_at: new Date().toISOString(),
    },
    {
      user_id: 'demo_user_2',
      display_name: 'Jordan',
      avatar_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop',
      role: 'member',
      streak: 3,
      participation_rate: 0.75,
      total_responses: 9,
      joined_at: new Date().toISOString(),
    },
    {
      user_id: 'demo_user_3',
      display_name: 'Sam',
      avatar_url: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&h=200&fit=crop',
      role: 'member',
      streak: 7,
      participation_rate: 0.95,
      total_responses: 15,
      joined_at: new Date().toISOString(),
    },
    {
      user_id: 'demo_user_4',
      display_name: 'Riley',
      avatar_url: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&h=200&fit=crop',
      role: 'member',
      streak: 2,
      participation_rate: 0.6,
      total_responses: 6,
      joined_at: new Date().toISOString(),
    },
  ],
};

export const DEMO_CHALLENGE: ApiChallenge = {
  id: 'demo_challenge_1',
  group_id: DEMO_GROUP_ID,
  type: 'snap',
  prompt: 'Show us your view right now!',
  prompt_text: 'Show us your view right now!',
  options: null,
  options_json: null,
  triggered_by: 'demo_user_1',
  triggered_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  status: 'active',
  countdown_seconds: 300,
};

export const DEMO_RESPONSES: ApiChallengeResponse[] = [
  {
    id: 'demo_response_1',
    challenge_id: 'demo_challenge_1',
    user_id: 'demo_user_1',
    display_name: 'Alex',
    avatar_url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop',
    photo_url: 'https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=600&h=800&fit=crop',
    answer_index: null,
    response_time_ms: 3200,
    responded_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
  },
  {
    id: 'demo_response_2',
    challenge_id: 'demo_challenge_1',
    user_id: 'demo_user_3',
    display_name: 'Sam',
    avatar_url: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&h=200&fit=crop',
    photo_url: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600&h=800&fit=crop',
    answer_index: null,
    response_time_ms: 5100,
    responded_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
  },
];

export function isDemoGroup(id: string | undefined): boolean {
  return id === DEMO_GROUP_ID;
}
