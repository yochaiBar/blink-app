import { Router, Response } from 'express';
import { query } from '../config/database';
import { authenticate, AuthRequest } from '../middleware/auth';
import { CHALLENGE_COUNTDOWN_SECONDS } from '../utils/constants';

const router = Router();

router.use(authenticate);

// ── Preset quiz pools ──────────────────────────────────────────
const QUIZ_PRESETS = {
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

function getRandomQuiz(type: 'food' | 'most_likely' | 'rate_day') {
  const pool = QUIZ_PRESETS[type];
  return pool[Math.floor(Math.random() * pool.length)];
}

// ── Helper: process skip penalties when challenge expires ───────
async function processSkipsForChallenge(challengeId: string, groupId: string) {
  // Get all group members
  const members = await query(
    `SELECT user_id FROM group_members WHERE group_id = $1`,
    [groupId]
  );

  // Get who responded
  const responded = await query(
    `SELECT user_id FROM challenge_responses WHERE challenge_id = $1`,
    [challengeId]
  );
  const respondedIds = new Set(responded.rows.map((r: any) => r.user_id));

  // Get group penalty type
  const group = await query(`SELECT skip_penalty_type FROM groups WHERE id = $1`, [groupId]);
  const penaltyType = group.rows[0]?.skip_penalty_type || 'wanted_poster';

  // Increment total_challenges for all members
  await query(
    `UPDATE group_members SET total_challenges = total_challenges + 1 WHERE group_id = $1`,
    [groupId]
  );

  for (const member of members.rows) {
    if (respondedIds.has(member.user_id)) {
      // Responded: increment stats and streak
      await query(
        `UPDATE group_members
         SET total_responses = total_responses + 1,
             current_streak = current_streak + 1
         WHERE group_id = $1 AND user_id = $2`,
        [groupId, member.user_id]
      );
    } else {
      // Skipped: insert skip response, reset streak, apply penalty
      await query(
        `INSERT INTO challenge_responses (challenge_id, user_id, response_type)
         VALUES ($1, $2, 'skip')
         ON CONFLICT (challenge_id, user_id) DO NOTHING`,
        [challengeId, member.user_id]
      );

      await query(
        `UPDATE group_members SET current_streak = 0
         WHERE group_id = $1 AND user_id = $2`,
        [groupId, member.user_id]
      );

      // Apply penalty if not 'none'
      if (penaltyType !== 'none') {
        const SILLY_AVATARS = ['🤡', '🐸', '💩', '👻', '🤖', '👽', '🦄', '🐔'];
        const WANTED_TEXTS = [
          "WANTED: Last seen dodging group challenges",
          "MISSING IN ACTION: Probably napping",
          "WANTED: For crimes against group participation",
          "MIA: May have been abducted by aliens",
          "WANTED: Failed to blink in time",
        ];

        const penaltyData = penaltyType === 'avatar_change'
          ? { silly_avatar: SILLY_AVATARS[Math.floor(Math.random() * SILLY_AVATARS.length)] }
          : penaltyType === 'wanted_poster'
          ? { text: WANTED_TEXTS[Math.floor(Math.random() * WANTED_TEXTS.length)] }
          : { text: `${member.user_id} is the group's servant today! Send them tasks.` };

        await query(
          `INSERT INTO active_penalties (group_id, user_id, penalty_type, penalty_data, expires_at)
           VALUES ($1, $2, $3, $4, NOW() + INTERVAL '24 hours')`,
          [groupId, member.user_id, penaltyType, JSON.stringify(penaltyData)]
        );
      }
    }
  }
}

// ── POST /api/groups/:groupId/challenges — Trigger a challenge ──
router.post('/groups/:groupId/challenges', async (req: AuthRequest, res: Response) => {
  const groupId = req.params.groupId as string;
  const { type } = req.body; // 'snap', 'quiz_food', 'quiz_most_likely', 'quiz_rate_day'

  const membership = await query(
    `SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [groupId, req.userId]
  );
  if (membership.rows.length === 0) {
    res.status(403).json({ error: 'Not a member of this group' });
    return;
  }

  // Expire any active challenge and process skips
  const activeChallenges = await query(
    `SELECT id FROM challenges WHERE group_id = $1 AND status = 'active'`,
    [groupId]
  );
  for (const ac of activeChallenges.rows) {
    await processSkipsForChallenge(ac.id, groupId);
  }
  await query(
    `UPDATE challenges SET status = 'expired' WHERE group_id = $1 AND status = 'active'`,
    [groupId]
  );

  // Build challenge based on type
  let challengeType = 'snap';
  let promptText: string | null = null;
  let optionsJson: string | null = null;

  if (type && type.startsWith('quiz_')) {
    challengeType = 'quiz';
    const quizType = type.replace('quiz_', '') as 'food' | 'most_likely' | 'rate_day';
    const quiz = getRandomQuiz(quizType);
    promptText = quiz.prompt;

    if (quizType === 'most_likely') {
      // Options are group member names
      const members = await query(
        `SELECT u.id, u.display_name FROM group_members gm
         JOIN users u ON u.id = gm.user_id WHERE gm.group_id = $1`,
        [groupId]
      );
      optionsJson = JSON.stringify(members.rows.map((m: any) => m.display_name || 'Anonymous'));
    } else {
      optionsJson = JSON.stringify(quiz.options);
    }
  }

  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
  const result = await query(
    `INSERT INTO challenges (group_id, type, prompt_text, options_json, triggered_by, expires_at, countdown_seconds)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [groupId, challengeType, promptText, optionsJson, req.userId, expiresAt, CHALLENGE_COUNTDOWN_SECONDS]
  );

  res.status(201).json(result.rows[0]);
});

// ── GET active challenge ──
router.get('/groups/:groupId/challenges/active', async (req: AuthRequest, res: Response) => {
  const groupId = req.params.groupId as string;

  const membership = await query(
    `SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [groupId, req.userId]
  );
  if (membership.rows.length === 0) {
    res.status(403).json({ error: 'Not a member of this group' });
    return;
  }

  // Auto-expire and process skips
  const expired = await query(
    `SELECT id FROM challenges
     WHERE group_id = $1 AND status = 'active' AND expires_at < NOW()`,
    [groupId]
  );
  for (const e of expired.rows) {
    await processSkipsForChallenge(e.id, groupId);
  }
  await query(
    `UPDATE challenges SET status = 'expired'
     WHERE group_id = $1 AND status = 'active' AND expires_at < NOW()`,
    [groupId]
  );

  const result = await query(
    `SELECT * FROM challenges WHERE group_id = $1 AND status = 'active' LIMIT 1`,
    [groupId]
  );

  if (result.rows.length === 0) {
    res.json(null);
    return;
  }

  const challenge = result.rows[0];
  const userResponse = await query(
    `SELECT id FROM challenge_responses WHERE challenge_id = $1 AND user_id = $2`,
    [challenge.id, req.userId]
  );

  res.json({
    ...challenge,
    user_has_responded: userResponse.rows.length > 0,
  });
});

// ── POST respond to challenge ──
router.post('/:id/respond', async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;
  const { photo_url, response_time_ms, answer_index } = req.body;

  const challenge = await query(`SELECT * FROM challenges WHERE id = $1`, [id]);
  if (challenge.rows.length === 0) {
    res.status(404).json({ error: 'Challenge not found' });
    return;
  }

  const c = challenge.rows[0];

  const membership = await query(
    `SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [c.group_id, req.userId]
  );
  if (membership.rows.length === 0) {
    res.status(403).json({ error: 'Not a member of this group' });
    return;
  }

  const existing = await query(
    `SELECT id FROM challenge_responses WHERE challenge_id = $1 AND user_id = $2`,
    [id, req.userId]
  );
  if (existing.rows.length > 0) {
    res.status(400).json({ error: 'Already responded' });
    return;
  }

  const responseType = c.type === 'quiz' ? 'answer' : 'photo';
  const result = await query(
    `INSERT INTO challenge_responses (challenge_id, user_id, response_type, photo_url, answer_index, response_time_ms)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [id, req.userId, responseType, photo_url || null, answer_index ?? null, response_time_ms || null]
  );

  // Check if all responded -> complete
  const totalMembers = await query(
    `SELECT COUNT(*) FROM group_members WHERE group_id = $1`,
    [c.group_id]
  );
  const totalResponses = await query(
    `SELECT COUNT(*) FROM challenge_responses WHERE challenge_id = $1`,
    [id]
  );
  if (parseInt(totalResponses.rows[0].count) >= parseInt(totalMembers.rows[0].count)) {
    await query(`UPDATE challenges SET status = 'completed' WHERE id = $1`, [id]);
    await processSkipsForChallenge(id, c.group_id);
  }

  res.status(201).json(result.rows[0]);
});

// ── GET responses (can't peek until you play) ──
router.get('/:id/responses', async (req: AuthRequest, res: Response) => {
  const id = req.params.id as string;

  const userResponse = await query(
    `SELECT id FROM challenge_responses WHERE challenge_id = $1 AND user_id = $2`,
    [id, req.userId]
  );
  if (userResponse.rows.length === 0) {
    res.status(403).json({ error: "Can't peek until you play! Respond first." });
    return;
  }

  const responses = await query(
    `SELECT cr.*, u.display_name, u.avatar_url
     FROM challenge_responses cr
     JOIN users u ON u.id = cr.user_id
     WHERE cr.challenge_id = $1
     ORDER BY cr.responded_at`,
    [id]
  );

  res.json(responses.rows);
});

// ── GET challenge history ──
router.get('/groups/:groupId/challenges/history', async (req: AuthRequest, res: Response) => {
  const groupId = req.params.groupId as string;

  const membership = await query(
    `SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [groupId, req.userId]
  );
  if (membership.rows.length === 0) {
    res.status(403).json({ error: 'Not a member of this group' });
    return;
  }

  const result = await query(
    `SELECT c.*,
       (SELECT COUNT(*) FROM challenge_responses WHERE challenge_id = c.id AND response_type != 'skip') as response_count,
       EXISTS(SELECT 1 FROM challenge_responses WHERE challenge_id = c.id AND user_id = $2 AND response_type != 'skip') as user_responded
     FROM challenges c
     WHERE c.group_id = $1 AND c.status IN ('completed', 'expired')
     ORDER BY c.triggered_at DESC
     LIMIT 20`,
    [groupId, req.userId]
  );

  res.json(result.rows);
});

export default router;
