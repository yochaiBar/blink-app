import Anthropic from '@anthropic-ai/sdk';
import { query } from '../config/database';
import logger from '../utils/logger';

// Types
export type AiPersonality = 'family_friendly' | 'funny' | 'spicy' | 'sarcastic' | 'motivational' | 'extreme' | 'sexy' | 'no_filter';

export interface GeneratedChallenge {
  type: 'snap' | 'quiz' | 'poll';
  prompt: string;
  options?: string[];
}

export interface GeneratedSuperlative {
  superlative: string;
  funFact: string;
}

// Feature gate
export function isAiEnabled(): boolean {
  return process.env.AI_ENABLED === 'true' && !!process.env.ANTHROPIC_API_KEY;
}

// Lazy client
let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (client) return client;
  if (!process.env.ANTHROPIC_API_KEY) return null;
  client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return client;
}

// Personality system prompts - these shape ALL AI output
const PERSONALITY_PROMPTS: Record<AiPersonality, string> = {
  family_friendly: 'You are a warm, wholesome group activity host. Keep everything PG-rated and inclusive. Use gentle humor. Never reference alcohol, drugs, dating, or anything inappropriate.',
  funny: 'You are a hilarious group chat comedian. Use witty wordplay, pop culture references, and playful roasts. Think funniest person in the group chat. Keep it light and fun.',
  spicy: 'You are a bold, daring group host who pushes boundaries. Create challenges that are edgy and provocative but not offensive. Think truth-or-dare energy. Use innuendo.',
  sarcastic: 'You are extremely sarcastic and deadpan. Every compliment is backhanded. Every challenge has a judgmental comment. Channel a bored reality TV judge who secretly loves the contestants.',
  motivational: 'You are an intense life coach and hype machine. Everything is EPIC and LEGENDARY. Use caps for emphasis. Treat every response like they just won the Olympics. High energy, zero chill.',
  extreme: 'You are an unhinged chaos agent. Create wild, unexpected, absurd challenges. Think "Florida Man" energy meets improv comedy. Nothing harmful, but everything is dialed to 11.',
  sexy: 'You are a flirty, confident host with Love Island energy. Challenges involve confidence and showing off. Keep it suggestive but tasteful. Think dating show host.',
  no_filter: 'You are completely unfiltered and brutally honest. Roasts are savage. Compliments are rare and backhanded. Dark humor is your native language. Still avoid hate speech.',
};

// Core Claude call wrapper with logging and fallback
async function callClaude(systemPrompt: string, userPrompt: string, groupId?: string, functionName?: string): Promise<string | null> {
  if (!isAiEnabled()) return null;
  const anthropic = getClient();
  if (!anthropic) return null;

  const start = Date.now();
  try {
    const response = await anthropic.messages.create({
      model: process.env.AI_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: parseInt(process.env.AI_MAX_TOKENS || '300', 10),
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content[0]?.type === 'text' ? response.content[0].text : null;
    const latency = Date.now() - start;
    const tokens = response.usage?.output_tokens || 0;

    // Log to ai_generation_log (fire and forget)
    if (groupId) {
      query(
        `INSERT INTO ai_generation_log (group_id, function_name, personality, tokens_used, latency_ms, fallback_used)
         VALUES ($1, $2, $3, $4, $5, false)`,
        [groupId, functionName || 'unknown', null, tokens, latency]
      ).catch(() => {});
    }

    return text;
  } catch (err: unknown) {
    logger.error('Claude API call failed', { error: err instanceof Error ? err.message : String(err), functionName });
    // Log fallback usage
    if (groupId) {
      query(
        `INSERT INTO ai_generation_log (group_id, function_name, fallback_used) VALUES ($1, $2, true)`,
        [groupId, functionName || 'unknown']
      ).catch(() => {});
    }
    return null;
  }
}

// Helper to safely parse JSON from Claude's response
function parseJSON<T>(text: string | null): T | null {
  if (!text) return null;
  try {
    // Claude sometimes wraps in markdown code blocks
    const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

// ─── PUBLIC FUNCTIONS ───────────────────────────────────────

// FALLBACK POOLS (used when AI is unavailable)
const FALLBACK_SNAP_PROMPTS = [
  'Show us what you see right now!',
  'Selfie time! No filters allowed',
  'What are you doing RIGHT NOW?',
  'Show us your current view',
  'Quick! Snap your surroundings!',
  'Show us something that made you smile today',
  'What did you last eat? Show us!',
  'Show us your outfit today',
];

const FALLBACK_QUIZ_QUESTIONS = [
  { prompt: 'Who in the group would survive a zombie apocalypse?', options: [] as string[] },
  { prompt: 'Who is most likely to become famous?', options: [] as string[] },
  { prompt: 'Who would win in a cooking competition?', options: [] as string[] },
  { prompt: 'Who gives the best advice?', options: [] as string[] },
  { prompt: 'Who is most likely to sleep through an earthquake?', options: [] as string[] },
];

const FALLBACK_SUPERLATIVES = [
  'Most likely to go viral',
  'Group MVP',
  'Speed demon',
  'The reliable one',
  'Heart of the group',
  'Most photogenic',
  'The trendsetter',
];

const FALLBACK_PENALTIES: Record<string, string[]> = {
  wanted_poster: [
    'WANTED: {name} -- Last seen avoiding the group challenge!',
    'MISSING: {name} -- Reward: One completed challenge',
    'WANTED: {name} -- Crime: Being too cool for the group',
  ],
  avatar_change: [
    '{name} has been sentenced to a silly avatar for 24 hours!',
    '{name} lost their avatar privileges. Enjoy the makeover!',
  ],
  servant: [
    '{name} is the group servant today! Send them your tasks!',
    '{name} must do whatever the group says for the next 24 hours!',
  ],
};

export async function generateChallenge(
  groupId: string,
  personality: AiPersonality,
  memberNames: string[],
  recentChallenges: string[]
): Promise<GeneratedChallenge> {
  const systemPrompt = PERSONALITY_PROMPTS[personality] + '\n\nYou generate fun group challenges for a photo-sharing app called Blink.';
  const userPrompt = `Group members: ${memberNames.join(', ')}.
Recent challenges (DO NOT repeat these): ${recentChallenges.join('; ') || 'none yet'}.

Generate ONE new challenge. Return ONLY valid JSON:
{"type": "snap" or "quiz", "prompt": "challenge text under 100 chars", "options": ["opt1","opt2","opt3","opt4"]}
For "snap" type, options must be empty array []. For "quiz", provide exactly 4 fun options.
Vary between snap and quiz types.`;

  const result = parseJSON<GeneratedChallenge>(
    await callClaude(systemPrompt, userPrompt, groupId, 'generateChallenge')
  );

  if (result && result.prompt) return result;

  // Fallback
  const isQuiz = Math.random() > 0.6;
  if (isQuiz && memberNames.length >= 2) {
    const q = FALLBACK_QUIZ_QUESTIONS[Math.floor(Math.random() * FALLBACK_QUIZ_QUESTIONS.length)];
    const shuffled = [...memberNames].sort(() => Math.random() - 0.5).slice(0, 4);
    return { type: 'quiz', prompt: q.prompt, options: shuffled };
  }
  return { type: 'snap', prompt: FALLBACK_SNAP_PROMPTS[Math.floor(Math.random() * FALLBACK_SNAP_PROMPTS.length)], options: [] };
}

export async function generateSpotlightSuperlative(
  featuredUser: { displayName: string; streak: number; totalResponses: number; participationRate: number },
  personality: AiPersonality
): Promise<GeneratedSuperlative> {
  const systemPrompt = PERSONALITY_PROMPTS[personality] + '\n\nYou write fun daily spotlight features for group members.';
  const userPrompt = `Featured member: ${featuredUser.displayName}
Stats: ${featuredUser.streak}-day streak, ${featuredUser.totalResponses} total responses, ${featuredUser.participationRate}% participation rate.

Write a fun superlative and a one-line fun fact. Return ONLY valid JSON:
{"superlative": "Most likely to...", "funFact": "Fun stat or roast about them"}
Keep each under 60 characters.`;

  const result = parseJSON<GeneratedSuperlative>(
    await callClaude(systemPrompt, userPrompt, undefined, 'generateSpotlightSuperlative')
  );

  if (result && result.superlative) return result;
  return {
    superlative: FALLBACK_SUPERLATIVES[Math.floor(Math.random() * FALLBACK_SUPERLATIVES.length)],
    funFact: `${featuredUser.participationRate}% participation rate!`,
  };
}

export async function generateNotificationCopy(
  type: string,
  context: { groupName?: string; challengeType?: string; respondedNames?: string[]; milestone?: number; userName?: string },
  personality: AiPersonality
): Promise<{ title: string; body: string }> {
  const systemPrompt = PERSONALITY_PROMPTS[personality] + '\n\nYou write short, punchy push notification messages for a social app.';
  const userPrompt = `Write a push notification for event: "${type}"
Context: ${JSON.stringify(context)}
Return ONLY valid JSON: {"title": "short title", "body": "notification body under 80 chars"}`;

  const result = parseJSON<{ title: string; body: string }>(
    await callClaude(systemPrompt, userPrompt, undefined, 'generateNotificationCopy')
  );

  if (result && result.title && result.body) return result;

  // Fallback
  const fallbacks: Record<string, { title: string; body: string }> = {
    challenge_started: { title: `${context.groupName || 'Your group'}`, body: `New ${context.challengeType || 'challenge'}! Respond before time runs out!` },
    streak_milestone: { title: 'Streak milestone!', body: `${context.userName || 'Someone'} hit a ${context.milestone}-day streak!` },
    challenge_completed: { title: 'Challenge complete!', body: 'Everyone responded. Check out the results!' },
  };
  return fallbacks[type] || { title: 'Blink', body: 'Something is happening in your group!' };
}

export async function generateSkipPenalty(
  userName: string,
  penaltyType: 'wanted_poster' | 'avatar_change' | 'servant',
  personality: AiPersonality
): Promise<{ text: string }> {
  const systemPrompt = PERSONALITY_PROMPTS[personality] + '\n\nYou write funny penalty descriptions for group members who missed a challenge.';
  const userPrompt = `Write a "${penaltyType}" penalty for "${userName}" who missed a group challenge.
Return ONLY valid JSON: {"text": "the penalty description under 120 chars"}
Make it funny and playful, not mean.`;

  const result = parseJSON<{ text: string }>(
    await callClaude(systemPrompt, userPrompt, undefined, 'generateSkipPenalty')
  );

  if (result && result.text) return result;

  const pool = FALLBACK_PENALTIES[penaltyType] || FALLBACK_PENALTIES.wanted_poster;
  return { text: pool[Math.floor(Math.random() * pool.length)].replace('{name}', userName) };
}

export async function commentOnResponses(
  responses: { userName: string; answerText?: string; responseTimeMs?: number }[],
  personality: AiPersonality
): Promise<{ commentary: string }> {
  const systemPrompt = PERSONALITY_PROMPTS[personality] + '\n\nYou write brief, witty commentary on group challenge results.';
  const userPrompt = `The group just finished a challenge. Here are the responses:
${responses.map(r => `- ${r.userName}${r.answerText ? `: "${r.answerText}"` : ''}${r.responseTimeMs ? ` (${(r.responseTimeMs / 1000).toFixed(1)}s)` : ''}`).join('\n')}

Write ONE short commentary line (under 100 chars). Be funny. Reference specific people.
Return ONLY valid JSON: {"commentary": "your commentary"}`;

  const result = parseJSON<{ commentary: string }>(
    await callClaude(systemPrompt, userPrompt, undefined, 'commentOnResponses')
  );

  if (result && result.commentary) return result;
  return { commentary: 'Great responses everyone!' };
}
