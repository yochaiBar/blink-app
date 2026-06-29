/**
 * Seeded "Challenges around the world" data for the Home screen.
 *
 * Each WorldwideChallenge represents one challenge prompt that multiple people
 * around the world responded to. Photos are shown as a 2-photo grid + "+N more"
 * tile to drive FOMO and teach new users what Blink challenges look like.
 *
 * Photos come from Unsplash. totalCount is intentionally larger than
 * photos.length to signal that there's more to unlock.
 *
 * When the real "Share to world" flow ships, these get replaced by actual
 * shared content from the server.
 */

export interface WorldwidePhoto {
  id: string;
  userName: string;
  location: string;
  photoUrl: string;
}

export interface WorldwideChallenge {
  promptId: string;
  prompt: string;
  timeAgo: string;
  totalCount: number;
  photos: WorldwidePhoto[];
  reactions: Array<{ emoji: string; count: number }>;
}

export const WORLDWIDE_CHALLENGES: WorldwideChallenge[] = [
  {
    promptId: 'morning_ritual',
    prompt: 'Your morning ritual — capture it now',
    timeAgo: '2h',
    totalCount: 47,
    photos: [
      {
        id: 'ww_tokyo_morning',
        userName: 'Yuki',
        location: 'Tokyo',
        photoUrl: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800&h=1000&fit=crop',
      },
      {
        id: 'ww_mumbai_chai',
        userName: 'Priya',
        location: 'Mumbai',
        photoUrl: 'https://images.unsplash.com/photo-1517256673644-36ad11246d21?w=800&h=1000&fit=crop',
      },
      {
        id: 'ww_london_tea',
        userName: 'James',
        location: 'London',
        photoUrl: 'https://images.unsplash.com/photo-1564890369478-c89ca6d9cde9?w=800&h=1000&fit=crop',
      },
    ],
    reactions: [
      { emoji: '☕', count: 38 },
      { emoji: '🔥', count: 21 },
      { emoji: '😍', count: 9 },
    ],
  },
  {
    promptId: 'where_are_you',
    prompt: 'Where are you right now?',
    timeAgo: '3h',
    totalCount: 63,
    photos: [
      {
        id: 'ww_nyc_subway',
        userName: 'Alex',
        location: 'New York',
        photoUrl: 'https://images.unsplash.com/photo-1545194445-dddb8f4487c6?w=800&h=1000&fit=crop',
      },
      {
        id: 'ww_seoul_cafe',
        userName: 'Min-jun',
        location: 'Seoul',
        photoUrl: 'https://images.unsplash.com/photo-1514537099923-4c0fc7ebb1bc?w=800&h=1000&fit=crop',
      },
      {
        id: 'ww_berlin_street',
        userName: 'Anna',
        location: 'Berlin',
        photoUrl: 'https://images.unsplash.com/photo-1528728329032-2972f65dfb3f?w=800&h=1000&fit=crop',
      },
    ],
    reactions: [
      { emoji: '🌍', count: 54 },
      { emoji: '😲', count: 27 },
      { emoji: '🔥', count: 14 },
    ],
  },
  {
    promptId: 'snack_moment',
    prompt: 'Snack of the moment — go',
    timeAgo: '5h',
    totalCount: 52,
    photos: [
      {
        id: 'ww_sao_paulo_food',
        userName: 'Beatriz',
        location: 'São Paulo',
        photoUrl: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&h=1000&fit=crop',
      },
      {
        id: 'ww_mexico_market',
        userName: 'Diego',
        location: 'Mexico City',
        photoUrl: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=800&h=1000&fit=crop',
      },
      {
        id: 'ww_sydney_food',
        userName: 'Jack',
        location: 'Sydney',
        photoUrl: 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&h=1000&fit=crop',
      },
    ],
    reactions: [
      { emoji: '😋', count: 41 },
      { emoji: '🍕', count: 19 },
      { emoji: '🔥', count: 12 },
    ],
  },
  {
    promptId: 'sunset_now',
    prompt: 'Catch the sunset — drop it in the next 5 minutes',
    timeAgo: '4h',
    totalCount: 38,
    photos: [
      {
        id: 'ww_berlin_sunset',
        userName: 'Lena',
        location: 'Berlin',
        photoUrl: 'https://images.unsplash.com/photo-1501854140801-50d01698950b?w=800&h=1000&fit=crop',
      },
      {
        id: 'ww_cape_town_sunset',
        userName: 'Thando',
        location: 'Cape Town',
        photoUrl: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=800&h=1000&fit=crop',
      },
      {
        id: 'ww_london_sunset',
        userName: 'Olivia',
        location: 'London',
        photoUrl: 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=800&h=1000&fit=crop',
      },
    ],
    reactions: [
      { emoji: '🌇', count: 31 },
      { emoji: '😍', count: 22 },
      { emoji: '🧡', count: 11 },
    ],
  },
  {
    promptId: 'friday_fit',
    prompt: 'Friday outfit — show the fit',
    timeAgo: 'yesterday',
    totalCount: 29,
    photos: [
      {
        id: 'ww_london_walk',
        userName: 'Olivia',
        location: 'London',
        photoUrl: 'https://images.unsplash.com/photo-1483985988355-763728e1935b?w=800&h=1000&fit=crop',
      },
      {
        id: 'ww_milan_fashion',
        userName: 'Giulia',
        location: 'Milan',
        photoUrl: 'https://images.unsplash.com/photo-1469334031218-e382a71b716b?w=800&h=1000&fit=crop',
      },
      {
        id: 'ww_tokyo_style',
        userName: 'Hana',
        location: 'Tokyo',
        photoUrl: 'https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?w=800&h=1000&fit=crop',
      },
    ],
    reactions: [
      { emoji: '🔥', count: 24 },
      { emoji: '👗', count: 15 },
      { emoji: '😍', count: 8 },
    ],
  },
];
