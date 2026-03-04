/**
 * Notifications Route Tests - blink-server
 *
 * Covers:
 * - GET /api/notifications (list notifications)
 * - PATCH /api/notifications/read (mark all as read)
 * - PATCH /api/notifications/:id/read (mark single as read)
 */

import request from 'supertest';
import {
  createTestApp,
  generateAccessToken,
  TEST_USER_ID,
  TEST_GROUP_ID,
  TEST_NOTIFICATION_ID,
  makeNotification,
  queryResult,
} from './helpers';

import './setup';

import notificationRouter from '../routes/notifications';
import { query } from '../config/database';

const mockQuery = query as jest.MockedFunction<typeof query>;
const app = createTestApp(notificationRouter, '/api/notifications');

// ─────────────────────────────────────────────────────────────────
// GET /api/notifications
// ─────────────────────────────────────────────────────────────────
describe('GET /api/notifications', () => {
  const token = generateAccessToken(TEST_USER_ID);

  it('should return notifications with mapped types', async () => {
    const notifications = [
      {
        id: TEST_NOTIFICATION_ID,
        type: 'challenge_started',
        title: 'New Challenge!',
        body: 'Someone started a challenge',
        read: false,
        timestamp: new Date().toISOString(),
        groupId: TEST_GROUP_ID,
        groupName: 'Test Group',
        fromUserAvatar: 'https://example.com/avatar.jpg',
      },
      {
        id: 'notif-2',
        type: 'snap_received',
        title: 'New Response!',
        body: 'Alice responded',
        read: true,
        timestamp: new Date(Date.now() - 3600000).toISOString(),
        groupId: TEST_GROUP_ID,
        groupName: 'Test Group',
        fromUserAvatar: null,
      },
    ];

    mockQuery.mockResolvedValueOnce(queryResult(notifications));

    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);

    // Verify type mapping: challenge_started -> challenge
    expect(res.body[0].type).toBe('challenge');
    // snap_received -> reaction
    expect(res.body[1].type).toBe('reaction');
  });

  it('should map all known notification types correctly', async () => {
    const typeMappingTests = [
      { serverType: 'challenge_started', uiType: 'challenge' },
      { serverType: 'snap_received', uiType: 'reaction' },
      { serverType: 'group_joined', uiType: 'join' },
      { serverType: 'streak_milestone', uiType: 'streak' },
      { serverType: 'spotlight', uiType: 'spotlight' },
    ];

    const notifications = typeMappingTests.map((t, i) => ({
      id: `notif-${i}`,
      type: t.serverType,
      title: 'Test',
      body: 'Test',
      read: false,
      timestamp: new Date().toISOString(),
      groupId: TEST_GROUP_ID,
      groupName: 'G',
      fromUserAvatar: null,
    }));

    mockQuery.mockResolvedValueOnce(queryResult(notifications));

    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);

    for (let i = 0; i < typeMappingTests.length; i++) {
      expect(res.body[i].type).toBe(typeMappingTests[i].uiType);
    }
  });

  it('should pass through unknown notification types unchanged', async () => {
    const notifications = [
      {
        id: 'notif-unknown',
        type: 'some_future_type',
        title: 'Test',
        body: 'Test',
        read: false,
        timestamp: new Date().toISOString(),
        groupId: null,
        groupName: null,
        fromUserAvatar: null,
      },
    ];

    mockQuery.mockResolvedValueOnce(queryResult(notifications));

    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body[0].type).toBe('some_future_type');
  });

  it('should return empty array when no notifications exist', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app).get('/api/notifications');
    expect(res.status).toBe(401);
  });

  it('should handle database errors gracefully', async () => {
    mockQuery.mockRejectedValueOnce(new Error('Database unreachable'));

    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────
// PATCH /api/notifications/read (mark all)
// ─────────────────────────────────────────────────────────────────
describe('PATCH /api/notifications/read', () => {
  const token = generateAccessToken(TEST_USER_ID);

  it('should mark all notifications as read', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .patch('/api/notifications/read')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('All notifications marked as read');

    // Verify query was called with correct user_id
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('SET read = TRUE'),
      [TEST_USER_ID]
    );
  });

  it('should succeed even when no unread notifications exist', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .patch('/api/notifications/read')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app).patch('/api/notifications/read');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────
// PATCH /api/notifications/:id/read (mark single)
// ─────────────────────────────────────────────────────────────────
describe('PATCH /api/notifications/:id/read', () => {
  const token = generateAccessToken(TEST_USER_ID);

  it('should mark a single notification as read', async () => {
    const notification = makeNotification({ read: true });
    mockQuery.mockResolvedValueOnce(queryResult([notification]));

    const res = await request(app)
      .patch(`/api/notifications/${TEST_NOTIFICATION_ID}/read`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(TEST_NOTIFICATION_ID);
  });

  it('should return 404 when notification does not exist', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .patch('/api/notifications/nonexistent-id/read')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Notification not found');
  });

  it('should return 404 when notification belongs to another user', async () => {
    // The query includes user_id = $2 filter, so it returns empty for wrong user
    mockQuery.mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .patch(`/api/notifications/${TEST_NOTIFICATION_ID}/read`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app)
      .patch(`/api/notifications/${TEST_NOTIFICATION_ID}/read`);

    expect(res.status).toBe(401);
  });

  it('should handle database errors gracefully', async () => {
    mockQuery.mockRejectedValueOnce(new Error('Connection reset'));

    const res = await request(app)
      .patch(`/api/notifications/${TEST_NOTIFICATION_ID}/read`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(500);
  });
});
