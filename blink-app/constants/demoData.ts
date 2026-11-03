/**
 * Static content for the onboarding demo group ("Welcome Crew").
 *
 * Raw data only. Screens and hooks never import this file: they go through
 * services/demoSource.ts, which serves it in the same shapes the API returns.
 */
import { Group, GroupMember } from '@/types';
import { ApiGroupDetail, ApiChallenge, ApiChallengeResponse } from '@/types/api';
import { theme } from '@/constants/colors';

export const DEMO_GROUP_ID = 'demo_welcome_crew';
export const DEMO_CHALLENGE_ID = 'demo_challenge_1';
/** Every demo id starts with this, so a response/challenge id alone identifies demo content. */
export const DEMO_ID_PREFIX = 'demo_';
/** The current user's own response in the demo reveal. */
export const DEMO_OWN_RESPONSE_ID = 'demo_response_user';
/** How far in the future the demo challenge always ends. */
export const DEMO_CHALLENGE_WINDOW_MS = 30 * 60 * 1000;

// --- Photo pool (stand-ins for the crew's snaps; members show initials like real users) ---

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
    streak: 5,
    isOnline: true,
    totalSnaps: 12,
    totalReactions: 8,
  },
  {
    id: 'demo_user_2',
    name: 'Jordan',
    streak: 3,
    isOnline: true,
    totalSnaps: 9,
    totalReactions: 6,
  },
  {
    id: 'demo_user_3',
    name: 'Sam',
    streak: 7,
    isOnline: false,
    totalSnaps: 15,
    totalReactions: 11,
  },
  {
    id: 'demo_user_4',
    name: 'Riley',
    streak: 2,
    isOnline: false,
    totalSnaps: 6,
    totalReactions: 4,
  },
  {
    id: 'demo_user_5',
    name: 'Maya',
    streak: 4,
    isOnline: true,
    totalSnaps: 10,
    totalReactions: 9,
  },
  {
    id: 'demo_user_6',
    name: 'Leo',
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
  emoji: '🎉',
  members: DEMO_MEMBERS,
  lastActive: new Date().toISOString(),
  hasActiveChallenge: true,
  color: theme.coral,
  inviteCode: 'DEMO00',
  createdAt: new Date().toISOString(),
};

export const DEMO_GROUP_DETAIL: ApiGroupDetail = {
  id: DEMO_GROUP_ID,
  name: 'Welcome Crew',
  icon: '🎉',
  invite_code: 'DEMO00',
  created_by: 'demo_user_1',
  created_at: new Date().toISOString(),
  members: makeApiMembers(),
};

// --- Snap challenge (daily-rotating prompt) ---

export const DEMO_CHALLENGE: ApiChallenge = {
  id: DEMO_CHALLENGE_ID,
  group_id: DEMO_GROUP_ID,
  prompt: getDailyPrompt(),
  created_by: 'demo_user_1',
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + DEMO_CHALLENGE_WINDOW_MS).toISOString(),
  status: 'active',
};

// --- Snap responses (3-4 randomly picked from the photo pool) ---
// Like real responses they only say has_photo; the image comes from
// DEMO_PHOTO_URIS the way real photos come from the local photo store.

const daySeed = Math.floor(Date.now() / (1000 * 60 * 60 * 24));
const respondentCount = 3 + (daySeed % 2); // alternates between 3 and 4
const respondents = seededPick(DEMO_MEMBERS, respondentCount, daySeed);
const respondentPhotos = seededPick(DEMO_SNAP_PHOTOS, respondentCount, daySeed + 7);

export const DEMO_RESPONSES: ApiChallengeResponse[] = respondents.map((member, i) => ({
  id: `demo_response_${i + 1}`,
  challenge_id: DEMO_CHALLENGE_ID,
  user_id: member.id,
  display_name: member.name,
  has_photo: true,
  response_time_ms: 2000 + i * 1500,
  responded_at: new Date(Date.now() - (respondentCount - i) * 5 * 60 * 1000).toISOString(),
  created_at: new Date(Date.now() - (respondentCount - i) * 5 * 60 * 1000).toISOString(),
}));

export const DEMO_PHOTO_URIS: Record<string, string> = Object.fromEntries(
  DEMO_RESPONSES.map((r, i) => [r.id, respondentPhotos[i]]),
);
