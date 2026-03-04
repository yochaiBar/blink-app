/**
 * Activity Route Tests - blink-server
 *
 * Covers:
 * - GET /api/activity (activity feed)
 * - Pagination via `before` query parameter
 * - Empty feed handling
 * - Authentication requirements
 */

import request from 'supertest';
import {
  createTestApp,
  generateAccessToken,
  TEST_USER_ID,
  TEST_GROUP_ID,
  queryResult,
} from './helpers';

import './setup';

import activityRouter from '../routes/activity';
import { query } from '../config/database';

const mockQuery = query as jest.MockedFunction<typeof query>;
const app = createTestApp(activityRouter, '/api/activity');

describe('GET /api/activity', () => {
  const token = generateAccessToken(TEST_USER_ID);

  it('should return activity feed for authenticated user', async () => {
    const activities = [
      {
        type: 'snap',
        userId: TEST_USER_ID,
        userName: 'Test User',
        userAvatar: 'https://example.com/avatar.jpg',
        groupName: 'Test Group',
        groupId: TEST_GROUP_ID,
        message: 'Test User responded to a challenge',
        timestamp: new Date().toISOString(),
        imageUrl: 'https://example.com/photo.jpg',
        id: 'activity-1',
      },
      {
        type: 'join',
        userId: 'user-2',
        userName: 'New User',
        userAvatar: '',
        groupName: 'Test Group',
        groupId: TEST_GROUP_ID,
        message: 'New User joined Test Group',
        timestamp: new Date(Date.now() - 3600000).toISOString(),
        imageUrl: null,
        id: 'activity-2',
      },
    ];

    mockQuery.mockResolvedValueOnce(queryResult(activities));

    const res = await request(app)
      .get('/api/activity')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].type).toBe('snap');
    expect(res.body[1].type).toBe('join');
  });

  it('should support pagination with before parameter', async () => {
    const olderActivities = [
      {
        type: 'snap',
        userId: TEST_USER_ID,
        userName: 'Test User',
        userAvatar: '',
        groupName: 'Test Group',
        groupId: TEST_GROUP_ID,
        message: 'Older activity',
        timestamp: new Date(Date.now() - 86400000).toISOString(),
        imageUrl: null,
        id: 'activity-old-1',
      },
    ];

    mockQuery.mockResolvedValueOnce(queryResult(olderActivities));

    const before = new Date(Date.now() - 3600000).toISOString();
    const res = await request(app)
      .get(`/api/activity?before=${encodeURIComponent(before)}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);

    // Verify the query was called with the before parameter
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('$2'),
      expect.arrayContaining([TEST_USER_ID, before])
    );
  });

  it('should return empty array when no activity exists', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .get('/api/activity')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app).get('/api/activity');
    expect(res.status).toBe(401);
  });

  it('should limit results to 50 items', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([]));

    await request(app)
      .get('/api/activity')
      .set('Authorization', `Bearer ${token}`);

    // Verify LIMIT 50 is in the query parameters
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('LIMIT'),
      expect.arrayContaining([50])
    );
  });

  it('should handle database errors gracefully', async () => {
    mockQuery.mockRejectedValueOnce(new Error('Query timeout'));

    const res = await request(app)
      .get('/api/activity')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(500);
  });

  it('should include all activity types in response', async () => {
    const mixedActivities = [
      { type: 'snap', userId: 'u1', userName: 'A', userAvatar: '', groupName: 'G', groupId: 'g1', message: 'snap', timestamp: new Date().toISOString(), imageUrl: 'img', id: 'a1' },
      { type: 'challenge_triggered', userId: 'u2', userName: 'B', userAvatar: '', groupName: 'G', groupId: 'g1', message: 'challenge', timestamp: new Date().toISOString(), imageUrl: null, id: 'a2' },
      { type: 'join', userId: 'u3', userName: 'C', userAvatar: '', groupName: 'G', groupId: 'g1', message: 'join', timestamp: new Date().toISOString(), imageUrl: null, id: 'a3' },
    ];

    mockQuery.mockResolvedValueOnce(queryResult(mixedActivities));

    const res = await request(app)
      .get('/api/activity')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);

    const types = res.body.map((a: any) => a.type);
    expect(types).toContain('snap');
    expect(types).toContain('challenge_triggered');
    expect(types).toContain('join');
  });
});
