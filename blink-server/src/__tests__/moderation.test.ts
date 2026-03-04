/**
 * Moderation Route Tests - blink-server
 *
 * Covers:
 * - POST /api/moderation/report (report content or user)
 * - POST /api/moderation/block (block a user)
 * - GET /api/moderation/blocks (list blocked users)
 * - DELETE /api/moderation/blocks/:userId (unblock)
 */

import request from 'supertest';
import {
  createTestApp,
  generateAccessToken,
  TEST_USER_ID,
  TEST_USER_ID_2,
  TEST_USER_ID_3,
  TEST_RESPONSE_ID,
  queryResult,
  XSS_PAYLOADS,
} from './helpers';

import './setup';

import moderationRouter from '../routes/moderation';
import { query } from '../config/database';

const mockQuery = query as jest.MockedFunction<typeof query>;
const app = createTestApp(moderationRouter, '/api/moderation');

// ─────────────────────────────────────────────────────────────────
// POST /api/moderation/report
// ─────────────────────────────────────────────────────────────────
describe('POST /api/moderation/report', () => {
  const token = generateAccessToken(TEST_USER_ID);

  it('should submit a report successfully', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([{ id: 'report-1' }]));

    const res = await request(app)
      .post('/api/moderation/report')
      .set('Authorization', `Bearer ${token}`)
      .send({
        reported_user_id: TEST_USER_ID_2,
        content_type: 'user',
        reason: 'harassment',
        description: 'This user is being inappropriate',
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('report-1');
    expect(res.body.message).toContain('Report submitted');
  });

  it('should submit a report for photo content', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([{ id: 'report-2' }]));

    const res = await request(app)
      .post('/api/moderation/report')
      .set('Authorization', `Bearer ${token}`)
      .send({
        reported_content_id: TEST_RESPONSE_ID, // valid UUID
        content_type: 'photo',
        reason: 'nudity',
      });

    expect(res.status).toBe(201);
  });

  it('should submit a report without optional fields', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([{ id: 'report-3' }]));

    const res = await request(app)
      .post('/api/moderation/report')
      .set('Authorization', `Bearer ${token}`)
      .send({
        content_type: 'group',
        reason: 'spam',
      });

    expect(res.status).toBe(201);
  });

  it('should return 400 when trying to report yourself', async () => {
    const res = await request(app)
      .post('/api/moderation/report')
      .set('Authorization', `Bearer ${token}`)
      .send({
        reported_user_id: TEST_USER_ID,
        content_type: 'user',
        reason: 'spam',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Cannot report yourself');
  });

  it('should return 400 for missing content_type', async () => {
    const res = await request(app)
      .post('/api/moderation/report')
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'spam' });

    expect(res.status).toBe(400);
  });

  it('should return 400 for missing reason', async () => {
    const res = await request(app)
      .post('/api/moderation/report')
      .set('Authorization', `Bearer ${token}`)
      .send({ content_type: 'user' });

    expect(res.status).toBe(400);
  });

  it('should return 400 for invalid content_type', async () => {
    const res = await request(app)
      .post('/api/moderation/report')
      .set('Authorization', `Bearer ${token}`)
      .send({ content_type: 'invalid_type', reason: 'spam' });

    expect(res.status).toBe(400);
  });

  it('should return 400 for invalid reason', async () => {
    const res = await request(app)
      .post('/api/moderation/report')
      .set('Authorization', `Bearer ${token}`)
      .send({ content_type: 'user', reason: 'just_dont_like_them' });

    expect(res.status).toBe(400);
  });

  it('should return 400 for invalid reported_user_id format (not UUID)', async () => {
    const res = await request(app)
      .post('/api/moderation/report')
      .set('Authorization', `Bearer ${token}`)
      .send({
        reported_user_id: 'not-a-uuid',
        content_type: 'user',
        reason: 'spam',
      });

    expect(res.status).toBe(400);
  });

  it('should return 400 for description exceeding 500 characters', async () => {
    const res = await request(app)
      .post('/api/moderation/report')
      .set('Authorization', `Bearer ${token}`)
      .send({
        content_type: 'user',
        reason: 'other',
        description: 'X'.repeat(501),
      });

    expect(res.status).toBe(400);
  });

  it('should accept all valid reason enum values', async () => {
    const validReasons = ['inappropriate', 'spam', 'harassment', 'hate_speech', 'nudity', 'violence', 'other'];

    for (const reason of validReasons) {
      mockQuery.mockResolvedValueOnce(queryResult([{ id: `report-${reason}` }]));

      const res = await request(app)
        .post('/api/moderation/report')
        .set('Authorization', `Bearer ${token}`)
        .send({ content_type: 'user', reason });

      expect(res.status).toBe(201);
    }
  });

  it('should accept all valid content_type enum values', async () => {
    const validTypes = ['photo', 'user', 'group', 'challenge_response'];

    for (const content_type of validTypes) {
      mockQuery.mockResolvedValueOnce(queryResult([{ id: `report-${content_type}` }]));

      const res = await request(app)
        .post('/api/moderation/report')
        .set('Authorization', `Bearer ${token}`)
        .send({ content_type, reason: 'spam' });

      expect(res.status).toBe(201);
    }
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app)
      .post('/api/moderation/report')
      .send({ content_type: 'user', reason: 'spam' });

    expect(res.status).toBe(401);
  });

  it.each(XSS_PAYLOADS)(
    'should handle XSS payload in description without crashing: %s',
    async (payload) => {
      mockQuery.mockResolvedValueOnce(queryResult([{ id: 'report-xss' }]));

      const res = await request(app)
        .post('/api/moderation/report')
        .set('Authorization', `Bearer ${token}`)
        .send({
          content_type: 'user',
          reason: 'other',
          description: payload,
        });

      expect([201, 400]).toContain(res.status);
    }
  );
});

// ─────────────────────────────────────────────────────────────────
// POST /api/moderation/block
// ─────────────────────────────────────────────────────────────────
describe('POST /api/moderation/block', () => {
  const token = generateAccessToken(TEST_USER_ID);

  it('should block a user successfully', async () => {
    mockQuery
      .mockResolvedValueOnce(queryResult([{ id: TEST_USER_ID_2 }]))
      .mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .post('/api/moderation/block')
      .set('Authorization', `Bearer ${token}`)
      .send({ blocked_id: TEST_USER_ID_2 });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe('User blocked successfully');
  });

  it('should return 400 when trying to block yourself', async () => {
    const res = await request(app)
      .post('/api/moderation/block')
      .set('Authorization', `Bearer ${token}`)
      .send({ blocked_id: TEST_USER_ID });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Cannot block yourself');
  });

  it('should return 404 when blocked user does not exist', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .post('/api/moderation/block')
      .set('Authorization', `Bearer ${token}`)
      .send({ blocked_id: TEST_USER_ID_3 });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('User not found');
  });

  it('should return 400 for missing blocked_id', async () => {
    const res = await request(app)
      .post('/api/moderation/block')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('should return 400 for invalid UUID format', async () => {
    const res = await request(app)
      .post('/api/moderation/block')
      .set('Authorization', `Bearer ${token}`)
      .send({ blocked_id: 'not-a-uuid' });

    expect(res.status).toBe(400);
  });

  it('should handle duplicate block gracefully (ON CONFLICT DO NOTHING)', async () => {
    mockQuery
      .mockResolvedValueOnce(queryResult([{ id: TEST_USER_ID_2 }]))
      .mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .post('/api/moderation/block')
      .set('Authorization', `Bearer ${token}`)
      .send({ blocked_id: TEST_USER_ID_2 });

    expect(res.status).toBe(201);
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app)
      .post('/api/moderation/block')
      .send({ blocked_id: TEST_USER_ID_2 });

    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────
// GET /api/moderation/blocks
// ─────────────────────────────────────────────────────────────────
describe('GET /api/moderation/blocks', () => {
  const token = generateAccessToken(TEST_USER_ID);

  it('should return list of blocked users', async () => {
    const blocks = [
      {
        id: 'block-1',
        blocked_id: TEST_USER_ID_2,
        display_name: 'Blocked User',
        avatar_url: 'https://example.com/avatar.jpg',
        created_at: new Date().toISOString(),
      },
    ];

    mockQuery.mockResolvedValueOnce(queryResult(blocks));

    const res = await request(app)
      .get('/api/moderation/blocks')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].blocked_id).toBe(TEST_USER_ID_2);
  });

  it('should return empty array when no users are blocked', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .get('/api/moderation/blocks')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app).get('/api/moderation/blocks');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────
// DELETE /api/moderation/blocks/:userId
// ─────────────────────────────────────────────────────────────────
describe('DELETE /api/moderation/blocks/:userId', () => {
  const token = generateAccessToken(TEST_USER_ID);

  it('should unblock a user successfully', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([{ id: 'block-1' }]));

    const res = await request(app)
      .delete(`/api/moderation/blocks/${TEST_USER_ID_2}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('User unblocked successfully');
  });

  it('should return 404 when block does not exist', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .delete(`/api/moderation/blocks/${TEST_USER_ID_3}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Block not found');
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app)
      .delete(`/api/moderation/blocks/${TEST_USER_ID_2}`);

    expect(res.status).toBe(401);
  });

  it('should handle database errors gracefully', async () => {
    mockQuery.mockRejectedValueOnce(new Error('Connection lost'));

    const res = await request(app)
      .delete(`/api/moderation/blocks/${TEST_USER_ID_2}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(500);
  });
});
