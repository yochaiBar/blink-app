/**
 * Hardcoded "Trending around the world" examples for the Home screen.
 *
 * These are fake — illustrative examples to teach new users what Blink is
 * before they have any real group activity. Photos come from Unsplash. The
 * data is read-only on the client (composer disabled, reactions frozen).
 *
 * See ~/Documents/Obsidian Vault/Blink/Plans/Home screen + Trending Worldwide.md
 * for the full design. When the real "Share to world" flow lands, these get
 * phased out in favor of actual shared content.
 */

export interface WorldwideExampleComment {
  userName: string;
  text: string;
}

export interface WorldwideExample {
  id: string;
  userName: string;
  location: string;        // "Tokyo", "São Paulo", etc. — replaces group name in the UI
  photoUrl: string;        // Unsplash, ?w=800&h=1000&fit=crop suggested
  prompt: string;          // The challenge prompt the photo is responding to
  timeAgo: string;         // Pre-rendered ("2h", "5h", "yesterday") — these don't move
  reactions: Array<{ emoji: string; count: number }>;
  comments: WorldwideExampleComment[];
}

export const WORLDWIDE_EXAMPLES: WorldwideExample[] = [
  {
    id: 'ww_tokyo_morning',
    userName: 'Yuki',
    location: 'Tokyo',
    photoUrl: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800&h=1000&fit=crop',
    prompt: 'Your morning ritual — capture it now',
    timeAgo: '2h',
    reactions: [
      { emoji: '☕', count: 14 },
      { emoji: '🔥', count: 8 },
      { emoji: '😍', count: 3 },
    ],
    comments: [
      { userName: 'Hiro', text: 'matcha latte gang 🍵' },
      { userName: 'Mei', text: 'that ceramic is gorgeous' },
    ],
  },
  {
    id: 'ww_nyc_subway',
    userName: 'Alex',
    location: 'New York',
    photoUrl: 'https://images.unsplash.com/photo-1545194445-dddb8f4487c6?w=800&h=1000&fit=crop',
    prompt: 'Where are you right now?',
    timeAgo: '3h',
    reactions: [
      { emoji: '🚇', count: 22 },
      { emoji: '🗽', count: 11 },
    ],
    comments: [
      { userName: 'Sam', text: 'L train at 5pm 💀' },
      { userName: 'Riley', text: 'I miss the city' },
    ],
  },
  {
    id: 'ww_berlin_sunset',
    userName: 'Lena',
    location: 'Berlin',
    photoUrl: 'https://images.unsplash.com/photo-1528728329032-2972f65dfb3f?w=800&h=1000&fit=crop',
    prompt: 'Catch the sunset — drop it in the next 5 minutes',
    timeAgo: '4h',
    reactions: [
      { emoji: '🌇', count: 31 },
      { emoji: '😍', count: 17 },
      { emoji: '🔥', count: 5 },
    ],
    comments: [
      { userName: 'Jonas', text: 'spree river hits different' },
      { userName: 'Mira', text: 'i need to go outside' },
    ],
  },
  {
    id: 'ww_sao_paulo_food',
    userName: 'Beatriz',
    location: 'São Paulo',
    photoUrl: 'https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&h=1000&fit=crop',
    prompt: 'Snack of the moment',
    timeAgo: '5h',
    reactions: [
      { emoji: '🍕', count: 19 },
      { emoji: '😋', count: 12 },
    ],
    comments: [
      { userName: 'Caio', text: 'esse é o melhor lugar' },
      { userName: 'Luana', text: 'me leva da próxima' },
    ],
  },
  {
    id: 'ww_sydney_beach',
    userName: 'Jack',
    location: 'Sydney',
    photoUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800&h=1000&fit=crop',
    prompt: 'View from where you stand right now',
    timeAgo: '7h',
    reactions: [
      { emoji: '🌊', count: 28 },
      { emoji: '☀️', count: 15 },
      { emoji: '😎', count: 9 },
    ],
    comments: [
      { userName: 'Chloe', text: 'bondi never disappoints' },
      { userName: 'Will', text: 'how is this real life' },
    ],
  },
  {
    id: 'ww_mumbai_chai',
    userName: 'Priya',
    location: 'Mumbai',
    photoUrl: 'https://images.unsplash.com/photo-1517256673644-36ad11246d21?w=800&h=1000&fit=crop',
    prompt: 'Your morning ritual — capture it now',
    timeAgo: '8h',
    reactions: [
      { emoji: '🍵', count: 24 },
      { emoji: '❤️', count: 11 },
    ],
    comments: [
      { userName: 'Arjun', text: 'cutting chai forever' },
      { userName: 'Neha', text: 'the only way to start the day' },
    ],
  },
  {
    id: 'ww_cape_town_friends',
    userName: 'Thando',
    location: 'Cape Town',
    photoUrl: 'https://images.unsplash.com/photo-1529156069898-49953e39b3ac?w=800&h=1000&fit=crop',
    prompt: 'Group photo — get everyone in frame in the next 30 seconds',
    timeAgo: '10h',
    reactions: [
      { emoji: '🤝', count: 42 },
      { emoji: '🔥', count: 18 },
      { emoji: '😂', count: 7 },
    ],
    comments: [
      { userName: 'Sipho', text: 'best crew on the planet' },
      { userName: 'Aisha', text: 'we are unmatched' },
    ],
  },
  {
    id: 'ww_mexico_market',
    userName: 'Diego',
    location: 'Mexico City',
    photoUrl: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=800&h=1000&fit=crop',
    prompt: 'What you can see from where you are',
    timeAgo: '12h',
    reactions: [
      { emoji: '🌶️', count: 16 },
      { emoji: '😋', count: 21 },
    ],
    comments: [
      { userName: 'Sofia', text: 'el mercado los viernes 🤌' },
      { userName: 'Mateo', text: 'best tacos i ever had' },
    ],
  },
  {
    id: 'ww_london_walk',
    userName: 'Olivia',
    location: 'London',
    photoUrl: 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=800&h=1000&fit=crop',
    prompt: 'Friday outfit — show the fit',
    timeAgo: 'yesterday',
    reactions: [
      { emoji: '👗', count: 13 },
      { emoji: '🔥', count: 9 },
    ],
    comments: [
      { userName: 'Ethan', text: 'the trench is everything' },
      { userName: 'Hannah', text: 'where is that from' },
    ],
  },
  {
    id: 'ww_seoul_cafe',
    userName: 'Min-jun',
    location: 'Seoul',
    photoUrl: 'https://images.unsplash.com/photo-1514537099923-4c0fc7ebb1bc?w=800&h=1000&fit=crop',
    prompt: 'Where are you right now?',
    timeAgo: 'yesterday',
    reactions: [
      { emoji: '☕', count: 26 },
      { emoji: '😍', count: 14 },
    ],
    comments: [
      { userName: 'Ji-woo', text: 'this is the best café in seongsu' },
      { userName: 'Hana', text: 'going there this weekend' },
    ],
  },
];
