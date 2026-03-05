import { Group, GroupMember } from '@/types';
import { ApiGroupDetail, ApiChallenge, ApiChallengeResponse } from '@/types/api';
import { theme } from '@/constants/colors';

export const DEMO_GROUP_ID = 'demo_welcome_crew';

// --- Photo pools ---

const DEMO_AVATAR_PHOTOS = {
  alex: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&h=200&fit=crop',
  jordan: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop',
  sam: 'https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&h=200&fit=crop',
  riley: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&h=200&fit=crop',
  maya: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&h=200&fit=crop',
  leo: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?w=200&h=200&fit=crop',
};

const DEMO_SNAP_PHOTOS = [
  // Coffee shop
  'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=600&h=800&fit=crop',
  // Sunset
  'https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=600&h=800&fit=crop',
  // Pets (dog)
  'https://images.unsplash.com/photo-1587300003388-59208cc962cb?w=600&h=800&fit=crop',
  // Food
  'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=600&h=800&fit=crop',
  // Workspace
  'https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=600&h=800&fit=crop',
  // City skyline
  'https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?w=600&h=800&fit=crop',
  // Park / nature
  'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600&h=800&fit=crop',
  // Cozy indoor
  'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?w=600&h=800&fit=crop',
];

// --- Prompts ---

const DEMO_SNAP_PROMPTS = [
  'Show us your view right now!',
  'What are you eating?',
  'Show your outfit today!',
  'Your workspace right now',
  "What's making you smile?",
  'Best thing you see outside',
  'Show us your current mood in one photo',
];

/**
 * Pick a prompt based on the current day so it rotates daily
 * but stays stable within the same day.
 */
function getDailyPrompt(): string {
  const dayIndex = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
  return DEMO_SNAP_PROMPTS[dayIndex % DEMO_SNAP_PROMPTS.length];
}

/**
 * Deterministically pick `count` items from an array using a seed.
 * Returns a new array without modifying the original.
 */
function seededPick<T>(items: T[], count: number, seed: number): T[] {
  const shuffled = [...items];
  // Simple seeded shuffle (Fisher-Yates with LCG)
  let s = seed;
  for (let i = shuffled.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) & 0x7fffffff;
    const j = s % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, count);
}

// --- Members (6 total) ---

const DEMO_MEMBERS: GroupMember[] = [
  {
    id: 'demo_user_1',
    name: 'Alex',
    avatar: DEMO_AVATAR_PHOTOS.alex,
    streak: 5,
    isOnline: true,
    totalSnaps: 12,
    totalReactions: 8,
  },
  {
    id: 'demo_user_2',
    name: 'Jordan',
    avatar: DEMO_AVATAR_PHOTOS.jordan,
    streak: 3,
    isOnline: true,
    totalSnaps: 9,
    totalReactions: 6,
  },
  {
    id: 'demo_user_3',
    name: 'Sam',
    avatar: DEMO_AVATAR_PHOTOS.sam,
    streak: 7,
    isOnline: false,
    totalSnaps: 15,
    totalReactions: 11,
  },
  {
    id: 'demo_user_4',
    name: 'Riley',
    avatar: DEMO_AVATAR_PHOTOS.riley,
    streak: 2,
    isOnline: false,
    totalSnaps: 6,
    totalReactions: 4,
  },
  {
    id: 'demo_user_5',
    name: 'Maya',
    avatar: DEMO_AVATAR_PHOTOS.maya,
    streak: 4,
    isOnline: true,
    totalSnaps: 10,
    totalReactions: 9,
  },
  {
    id: 'demo_user_6',
    name: 'Leo',
    avatar: DEMO_AVATAR_PHOTOS.leo,
    streak: 6,
    isOnline: false,
    totalSnaps: 13,
    totalReactions: 7,
  },
];

// --- API-shaped member list ---

function makeApiMembers() {
  const roles: Record<string, string> = { demo_user_1: 'admin' };
  return DEMO_MEMBERS.map((m) => ({
    user_id: m.id,
    display_name: m.name,
    avatar_url: m.avatar,
    role: roles[m.id] || 'member',
    streak: m.streak,
    participation_rate: parseFloat((0.6 + Math.random() * 0.35).toFixed(2)),
    total_responses: m.totalSnaps ?? 0,
    joined_at: new Date().toISOString(),
  }));
}

// --- Group ---

export const DEMO_GROUP: Group = {
  id: DEMO_GROUP_ID,
  name: 'Welcome Crew',
  category: 'close_friends',
  emoji: '🎉',
  members: DEMO_MEMBERS,
  lastActive: new Date().toISOString(),
  hasActiveChallenge: true,
  challengeEndTime: Date.now() + 30 * 60 * 1000,
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
  members: makeApiMembers(),
};

// --- Snap challenge (daily-rotating prompt) ---

export const DEMO_CHALLENGE: ApiChallenge = {
  id: 'demo_challenge_1',
  group_id: DEMO_GROUP_ID,
  type: 'snap',
  prompt: getDailyPrompt(),
  prompt_text: getDailyPrompt(),
  options: null,
  options_json: null,
  triggered_by: 'demo_user_1',
  triggered_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  status: 'active',
  countdown_seconds: 300,
};

// --- Snap responses (3-4 randomly picked from the photo pool) ---

function buildDemoSnapResponses(): ApiChallengeResponse[] {
  const daySeed = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
  // Pick 3 or 4 respondents
  const respondentCount = 3 + (daySeed % 2); // alternates between 3 and 4
  const respondents = seededPick(DEMO_MEMBERS, respondentCount, daySeed);
  const photos = seededPick(DEMO_SNAP_PHOTOS, respondentCount, daySeed + 7);

  return respondents.map((member, i) => ({
    id: `demo_response_${i + 1}`,
    challenge_id: 'demo_challenge_1',
    user_id: member.id,
    display_name: member.name,
    avatar_url: member.avatar,
    photo_url: photos[i],
    answer_index: null,
    response_time_ms: 2000 + i * 1500,
    responded_at: new Date(Date.now() - (respondentCount - i) * 5 * 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - (respondentCount - i) * 5 * 60 * 1000).toISOString(),
  }));
}

export const DEMO_RESPONSES: ApiChallengeResponse[] = buildDemoSnapResponses();

// --- Quiz challenge (quiz_most_likely) ---

const QUIZ_QUESTIONS = [
  {
    prompt: "Who's most likely to forget their phone at home?",
    options: ['Alex', 'Jordan', 'Sam', 'Riley'],
  },
  {
    prompt: "Who's most likely to binge an entire series overnight?",
    options: ['Maya', 'Leo', 'Alex', 'Sam'],
  },
  {
    prompt: "Who's most likely to accidentally send a text to the wrong person?",
    options: ['Riley', 'Jordan', 'Maya', 'Leo'],
  },
  {
    prompt: "Who's most likely to show up late to their own party?",
    options: ['Leo', 'Alex', 'Riley', 'Jordan'],
  },
  {
    prompt: "Who's most likely to adopt every stray animal they see?",
    options: ['Sam', 'Maya', 'Jordan', 'Alex'],
  },
];

function getDailyQuiz() {
  const dayIndex = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
  return QUIZ_QUESTIONS[dayIndex % QUIZ_QUESTIONS.length];
}

export const DEMO_QUIZ_CHALLENGE: ApiChallenge = {
  id: 'demo_challenge_quiz_1',
  group_id: DEMO_GROUP_ID,
  type: 'quiz_most_likely',
  prompt: getDailyQuiz().prompt,
  prompt_text: getDailyQuiz().prompt,
  options: getDailyQuiz().options,
  options_json: getDailyQuiz().options,
  triggered_by: 'demo_user_2',
  triggered_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
  status: 'active',
  countdown_seconds: 180,
};

function buildDemoQuizResponses(): ApiChallengeResponse[] {
  const daySeed = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
  const respondents = seededPick(DEMO_MEMBERS, 4, daySeed + 99);

  return respondents.map((member, i) => ({
    id: `demo_quiz_response_${i + 1}`,
    challenge_id: 'demo_challenge_quiz_1',
    user_id: member.id,
    display_name: member.name,
    avatar_url: member.avatar,
    photo_url: null,
    answer_index: (daySeed + i) % 4,
    response_time_ms: 1200 + i * 800,
    responded_at: new Date(Date.now() - (4 - i) * 3 * 60 * 1000).toISOString(),
    created_at: new Date(Date.now() - (4 - i) * 3 * 60 * 1000).toISOString(),
  }));
}

export const DEMO_QUIZ_RESPONSES: ApiChallengeResponse[] = buildDemoQuizResponses();

// --- Helper ---

export function isDemoGroup(id: string | undefined): boolean {
  return id === DEMO_GROUP_ID;
}
