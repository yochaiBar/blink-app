// Re-export processSkipsForChallenge from its new home in the service layer
// so existing imports (e.g. queries.ts) continue to work.
export { processSkipsForChallenge } from '../../services/streakService';

// Column aliases to map DB schema names to client-expected field names.
// The DB uses triggered_by/triggered_at/prompt_text/options_json,
// but the client ApiChallenge type expects created_by/created_at/prompt/options.
export const CHALLENGE_SELECT = `
  id, group_id, type,
  prompt_text as prompt,
  options_json as options,
  triggered_by as created_by,
  triggered_at as created_at,
  expires_at, status, countdown_seconds
`;

export const QUIZ_PRESETS = {
  food: [
    { prompt: "What did you eat for lunch today?", options: ["Something healthy (sure...)", "Leftovers from 3 days ago", "Snacks count as a meal", "I forgot to eat"] },
    { prompt: "What's your go-to midnight snack?", options: ["Cereal at 2am like a champ", "Whatever's in the fridge", "I order delivery at midnight", "I sleep like a normal person"] },
    { prompt: "How would you describe your cooking skills?", options: ["Gordon Ramsay vibes", "I can boil water", "Microwave master", "Does cereal count?"] },
  ],
  most_likely: [
    { prompt: "Who in this group is most likely to fall asleep first at a sleepover?", options: [] },
    { prompt: "Who is most likely to accidentally send a text to the wrong person?", options: [] },
    { prompt: "Who is most likely to show up late to their own birthday?", options: [] },
    { prompt: "Who is most likely to cry during a movie?", options: [] },
    { prompt: "Who is most likely to survive a zombie apocalypse?", options: [] },
  ],
  rate_day: [
    { prompt: "Rate your day so far", options: ["1-3: Dumpster fire", "4-5: Meh", "6-7: Pretty decent", "8-10: Living my best life"] },
    { prompt: "How's your energy level right now?", options: ["Running on fumes", "Need coffee IV drip", "Surprisingly alive", "Unstoppable"] },
    { prompt: "How social are you feeling today?", options: ["Don't talk to me", "Small talk only", "Down to hang", "LET'S GO OUT"] },
  ],
};

export function getRandomQuiz(type: 'food' | 'most_likely' | 'rate_day') {
  const pool = QUIZ_PRESETS[type];
  return pool[Math.floor(Math.random() * pool.length)];
}
