/**
 * Challenges Route Tests - blink-server
 *
 * Covers all challenge-related endpoints.
 */

import request from 'supertest';
import {
  createTestApp,
  generateAccessToken,
  TEST_USER_ID,
  TEST_USER_ID_2,
  TEST_GROUP_ID,
  TEST_CHALLENGE_ID,
  TEST_RESPONSE_ID,
  makeChallenge,
  makeChallengeResponse,
  makeMembership,
  makeUser,
  queryResult,
} from './helpers';

import './setup';

import challengeRouter from '../routes/challenges';
import { query } from '../config/database';
import { emitToGroup } from '../socket';

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockEmit = emitToGroup as jest.MockedFunction<typeof emitToGroup>;
const app = createTestApp(challengeRouter, '/api/challenges');

// ─────────────────────────────────────────────────────────────────
// POST /api/challenges/groups/:groupId/challenges (trigger)
// ─────────────────────────────────────────────────────────────────
describe('POST /api/challenges/groups/:groupId/challenges', () => {
  const token = generateAccessToken(TEST_USER_ID);

  it('should trigger a snap challenge successfully', async () => {
    const challenge = makeChallenge();

    mockQuery
      .mockResolvedValueOnce(queryResult([makeMembership()]))     // membership check
      .mockResolvedValueOnce(queryResult([]))                      // no active challenges
      .mockResolvedValueOnce(queryResult([]))                      // expire active (noop)
      .mockResolvedValueOnce(queryResult([challenge]))             // INSERT challenge
      .mockResolvedValueOnce(queryResult([]))                      // group members for notification
      .mockResolvedValueOnce(queryResult([makeUser()]))            // trigger user name
      .mockResolvedValueOnce(queryResult([{ name: 'Test Group' }])); // group name

    const res = await request(app)
      .post(`/api/challenges/groups/${TEST_GROUP_ID}/challenges`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.type).toBe('snap');
    expect(mockEmit).toHaveBeenCalledWith(TEST_GROUP_ID, 'challenge:started', expect.any(Object));
  });

  it('should trigger a quiz challenge with food type', async () => {
    const challenge = makeChallenge({ type: 'quiz' });

    mockQuery
      .mockResolvedValueOnce(queryResult([makeMembership()]))
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([challenge]))
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([makeUser()]))
      .mockResolvedValueOnce(queryResult([{ name: 'Test Group' }]));

    const res = await request(app)
      .post(`/api/challenges/groups/${TEST_GROUP_ID}/challenges`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'quiz_food' });

    expect(res.status).toBe(201);
  });

  it('should return 403 when user is not a group member', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .post(`/api/challenges/groups/${TEST_GROUP_ID}/challenges`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Not a member of this group');
  });

  it('should return 400 for invalid challenge type', async () => {
    const res = await request(app)
      .post(`/api/challenges/groups/${TEST_GROUP_ID}/challenges`)
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'invalid_type' });

    expect(res.status).toBe(400);
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app)
      .post(`/api/challenges/groups/${TEST_GROUP_ID}/challenges`)
      .send({});

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────
// GET /api/challenges/groups/:groupId/challenges/active
// ─────────────────────────────────────────────────────────────────
describe('GET /api/challenges/groups/:groupId/challenges/active', () => {
  const token = generateAccessToken(TEST_USER_ID);

  it('should return active challenge with user_has_responded flag', async () => {
    const challenge = makeChallenge();

    mockQuery
      .mockResolvedValueOnce(queryResult([makeMembership()]))
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([challenge]))
      .mockResolvedValueOnce(queryResult([{ id: 'some-response' }]));

    const res = await request(app)
      .get(`/api/challenges/groups/${TEST_GROUP_ID}/challenges/active`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(TEST_CHALLENGE_ID);
    expect(res.body.user_has_responded).toBe(true);
  });

  it('should return null when no active challenge exists', async () => {
    mockQuery
      .mockResolvedValueOnce(queryResult([makeMembership()]))
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .get(`/api/challenges/groups/${TEST_GROUP_ID}/challenges/active`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });

  it('should return 403 when user is not a member', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .get(`/api/challenges/groups/${TEST_GROUP_ID}/challenges/active`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────
// POST /api/challenges/:id/respond
// ─────────────────────────────────────────────────────────────────
describe('POST /api/challenges/:id/respond', () => {
  const token = generateAccessToken(TEST_USER_ID);

  it('should submit a photo response successfully (same user as trigger)', async () => {
    // triggered_by = TEST_USER_ID (same as requester), so notification is skipped
    const challenge = makeChallenge({ triggered_by: TEST_USER_ID });
    const response = makeChallengeResponse();

    mockQuery
      .mockResolvedValueOnce(queryResult([challenge]))            // find challenge
      .mockResolvedValueOnce(queryResult([makeMembership()]))     // membership
      .mockResolvedValueOnce(queryResult([]))                      // no existing response
      .mockResolvedValueOnce(queryResult([response]))              // INSERT response
      // No notification queries since triggered_by === req.userId
      .mockResolvedValueOnce(queryResult([{ count: '2' }]))        // total members
      .mockResolvedValueOnce(queryResult([{ count: '1' }]));       // total responses

    const res = await request(app)
      .post(`/api/challenges/${TEST_CHALLENGE_ID}/respond`)
      .set('Authorization', `Bearer ${token}`)
      .send({ photo_url: 'https://example.com/photo.jpg', response_time_ms: 3500 });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
  });

  it('should submit response and notify trigger user when different', async () => {
    // triggered_by = different user, so notification IS sent
    const challenge = makeChallenge({ triggered_by: TEST_USER_ID_2 });
    const response = makeChallengeResponse();

    mockQuery
      .mockResolvedValueOnce(queryResult([challenge]))
      .mockResolvedValueOnce(queryResult([makeMembership()]))
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([response]))
      .mockResolvedValueOnce(queryResult([makeUser()]))            // responder name for notification
      // createNotification mock is handled globally
      .mockResolvedValueOnce(queryResult([{ count: '2' }]))
      .mockResolvedValueOnce(queryResult([{ count: '1' }]));

    const res = await request(app)
      .post(`/api/challenges/${TEST_CHALLENGE_ID}/respond`)
      .set('Authorization', `Bearer ${token}`)
      .send({ photo_url: 'https://example.com/photo.jpg' });

    expect(res.status).toBe(201);
    expect(mockEmit).toHaveBeenCalledWith(
      TEST_GROUP_ID,
      'challenge:response',
      expect.objectContaining({ challengeId: TEST_CHALLENGE_ID })
    );
  });

  it('should accept base64 photo response', async () => {
    const challenge = makeChallenge({ triggered_by: TEST_USER_ID }); // same user - no notif
    const response = makeChallengeResponse({ photo_url: 'data:image/jpeg;base64,/9j/4AA' });

    mockQuery
      .mockResolvedValueOnce(queryResult([challenge]))
      .mockResolvedValueOnce(queryResult([makeMembership()]))
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([response]))
      .mockResolvedValueOnce(queryResult([{ count: '5' }]))
      .mockResolvedValueOnce(queryResult([{ count: '1' }]));

    const res = await request(app)
      .post(`/api/challenges/${TEST_CHALLENGE_ID}/respond`)
      .set('Authorization', `Bearer ${token}`)
      .send({ photo_base64: 'data:image/jpeg;base64,/9j/4AA' });

    expect(res.status).toBe(201);
  });

  it('should submit a quiz answer response', async () => {
    const challenge = makeChallenge({ type: 'quiz', triggered_by: TEST_USER_ID });
    const response = makeChallengeResponse({ response_type: 'answer', answer_index: 2 });

    mockQuery
      .mockResolvedValueOnce(queryResult([challenge]))
      .mockResolvedValueOnce(queryResult([makeMembership()]))
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([response]))
      .mockResolvedValueOnce(queryResult([{ count: '3' }]))
      .mockResolvedValueOnce(queryResult([{ count: '1' }]));

    const res = await request(app)
      .post(`/api/challenges/${TEST_CHALLENGE_ID}/respond`)
      .set('Authorization', `Bearer ${token}`)
      .send({ answer_index: 2 });

    expect(res.status).toBe(201);
  });

  it('should return 404 when challenge does not exist', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .post(`/api/challenges/${TEST_CHALLENGE_ID}/respond`)
      .set('Authorization', `Bearer ${token}`)
      .send({ photo_url: 'https://example.com/photo.jpg' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Challenge not found');
  });

  it('should return 403 when user is not a group member', async () => {
    mockQuery
      .mockResolvedValueOnce(queryResult([makeChallenge()]))
      .mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .post(`/api/challenges/${TEST_CHALLENGE_ID}/respond`)
      .set('Authorization', `Bearer ${token}`)
      .send({ photo_url: 'https://example.com/photo.jpg' });

    expect(res.status).toBe(403);
  });

  it('should return 400 when user has already responded', async () => {
    mockQuery
      .mockResolvedValueOnce(queryResult([makeChallenge()]))
      .mockResolvedValueOnce(queryResult([makeMembership()]))
      .mockResolvedValueOnce(queryResult([{ id: 'existing-response' }]));

    const res = await request(app)
      .post(`/api/challenges/${TEST_CHALLENGE_ID}/respond`)
      .set('Authorization', `Bearer ${token}`)
      .send({ photo_url: 'https://example.com/photo.jpg' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Already responded');
  });

  it('should return 400 for negative response_time_ms', async () => {
    const res = await request(app)
      .post(`/api/challenges/${TEST_CHALLENGE_ID}/respond`)
      .set('Authorization', `Bearer ${token}`)
      .send({ response_time_ms: -100 });

    expect(res.status).toBe(400);
  });

  it('should return 400 for non-integer answer_index', async () => {
    const res = await request(app)
      .post(`/api/challenges/${TEST_CHALLENGE_ID}/respond`)
      .set('Authorization', `Bearer ${token}`)
      .send({ answer_index: 1.5 });

    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────
// GET /api/challenges/:id/responses
// ─────────────────────────────────────────────────────────────────
describe('GET /api/challenges/:id/responses', () => {
  const token = generateAccessToken(TEST_USER_ID);

  it('should return responses with reactions when user has responded', async () => {
    const responses = [
      { ...makeChallengeResponse(), display_name: 'User 1', avatar_url: null },
    ];
    const reactions = [
      { response_id: TEST_RESPONSE_ID, emoji: '🔥', count: '3', user_names: ['A', 'B', 'C'] },
    ];

    mockQuery
      .mockResolvedValueOnce(queryResult([{ id: 'my-response' }]))
      .mockResolvedValueOnce(queryResult(responses))
      .mockResolvedValueOnce(queryResult(reactions));

    const res = await request(app)
      .get(`/api/challenges/${TEST_CHALLENGE_ID}/responses`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].reactions).toHaveLength(1);
    expect(res.body[0].reactions[0].emoji).toBe('🔥');
    expect(res.body[0].reactions[0].count).toBe(3);
  });

  it('should return 403 when user has not responded (anti-peek)', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .get(`/api/challenges/${TEST_CHALLENGE_ID}/responses`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toContain("Can't peek");
  });

  it('should handle responses with no reactions', async () => {
    const responses = [{ ...makeChallengeResponse(), display_name: 'User 1', avatar_url: null }];

    mockQuery
      .mockResolvedValueOnce(queryResult([{ id: 'my-response' }]))
      .mockResolvedValueOnce(queryResult(responses))
      .mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .get(`/api/challenges/${TEST_CHALLENGE_ID}/responses`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body[0].reactions).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────
// GET /api/challenges/groups/:groupId/challenges/history
// ─────────────────────────────────────────────────────────────────
describe('GET /api/challenges/groups/:groupId/challenges/history', () => {
  const token = generateAccessToken(TEST_USER_ID);

  it('should return challenge history for group member', async () => {
    const history = [
      { ...makeChallenge({ status: 'completed' }), response_count: 3, member_count: 5, user_responded: true },
    ];

    mockQuery
      .mockResolvedValueOnce(queryResult([makeMembership()]))
      .mockResolvedValueOnce(queryResult(history));

    const res = await request(app)
      .get(`/api/challenges/groups/${TEST_GROUP_ID}/challenges/history`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
  });

  it('should return 403 when user is not a group member', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .get(`/api/challenges/groups/${TEST_GROUP_ID}/challenges/history`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('should return empty array when no challenge history exists', async () => {
    mockQuery
      .mockResolvedValueOnce(queryResult([makeMembership()]))
      .mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .get(`/api/challenges/groups/${TEST_GROUP_ID}/challenges/history`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────
// POST /api/challenges/responses/:responseId/reactions (add)
// ─────────────────────────────────────────────────────────────────
describe('POST /api/challenges/responses/:responseId/reactions', () => {
  const token = generateAccessToken(TEST_USER_ID);

  it('should add a reaction to a response', async () => {
    const responseRow = { ...makeChallengeResponse(), group_id: TEST_GROUP_ID };
    const reaction = { id: 'reaction-1', response_id: TEST_RESPONSE_ID, user_id: TEST_USER_ID, emoji: '🔥' };

    mockQuery
      .mockResolvedValueOnce(queryResult([responseRow]))
      .mockResolvedValueOnce(queryResult([makeMembership()]))
      .mockResolvedValueOnce(queryResult([reaction]));

    const res = await request(app)
      .post(`/api/challenges/responses/${TEST_RESPONSE_ID}/reactions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ emoji: '🔥' });

    expect(res.status).toBe(201);
    expect(res.body.emoji).toBe('🔥');
  });

  it('should return 409 when reaction already exists (duplicate)', async () => {
    const responseRow = { ...makeChallengeResponse(), group_id: TEST_GROUP_ID };

    mockQuery
      .mockResolvedValueOnce(queryResult([responseRow]))
      .mockResolvedValueOnce(queryResult([makeMembership()]))
      .mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .post(`/api/challenges/responses/${TEST_RESPONSE_ID}/reactions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ emoji: '🔥' });

    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Reaction already exists');
  });

  it('should return 404 when response does not exist', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .post(`/api/challenges/responses/${TEST_RESPONSE_ID}/reactions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ emoji: '🔥' });

    expect(res.status).toBe(404);
  });

  it('should return 403 when user is not a group member', async () => {
    const responseRow = { ...makeChallengeResponse(), group_id: TEST_GROUP_ID };

    mockQuery
      .mockResolvedValueOnce(queryResult([responseRow]))
      .mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .post(`/api/challenges/responses/${TEST_RESPONSE_ID}/reactions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ emoji: '🔥' });

    expect(res.status).toBe(403);
  });

  it('should return 400 for missing emoji', async () => {
    const res = await request(app)
      .post(`/api/challenges/responses/${TEST_RESPONSE_ID}/reactions`)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('should return 400 for emoji exceeding max length', async () => {
    const res = await request(app)
      .post(`/api/challenges/responses/${TEST_RESPONSE_ID}/reactions`)
      .set('Authorization', `Bearer ${token}`)
      .send({ emoji: '🔥'.repeat(6) });

    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────
// DELETE /api/challenges/responses/:responseId/reactions/:emoji
// ─────────────────────────────────────────────────────────────────
describe('DELETE /api/challenges/responses/:responseId/reactions/:emoji', () => {
  const token = generateAccessToken(TEST_USER_ID);

  it('should remove a reaction successfully', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([{ id: 'reaction-1' }]));

    const res = await request(app)
      .delete(`/api/challenges/responses/${TEST_RESPONSE_ID}/reactions/${encodeURIComponent('🔥')}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Reaction removed');
  });

  it('should return 404 when reaction does not exist', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .delete(`/api/challenges/responses/${TEST_RESPONSE_ID}/reactions/${encodeURIComponent('🔥')}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Reaction not found');
  });
});
