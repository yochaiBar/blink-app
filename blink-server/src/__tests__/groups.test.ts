/**
 * Groups Route Tests - blink-server
 *
 * Covers:
 * - POST /api/groups (create group)
 * - GET /api/groups (list user groups)
 * - GET /api/groups/:id (group detail + members)
 * - POST /api/groups/join (join via invite code)
 * - POST /api/groups/:id/leave (leave group, admin transfer, group deletion)
 * - DELETE /api/groups/:id (admin delete group)
 */

import request from 'supertest';
import {
  createTestApp,
  generateAccessToken,
  TEST_USER_ID,
  TEST_USER_ID_2,
  TEST_USER_ID_3,
  TEST_GROUP_ID,
  TEST_INVITE_CODE,
  makeUser,
  makeGroup,
  makeMembership,
  queryResult,
  XSS_PAYLOADS,
  SQL_INJECTION_PAYLOADS,
} from './helpers';

import './setup';

import groupRouter from '../routes/groups';
import { query } from '../config/database';

const mockQuery = query as jest.MockedFunction<typeof query>;
const app = createTestApp(groupRouter, '/api/groups');

// ─────────────────────────────────────────────────────────────────
// POST /api/groups (create group)
// ─────────────────────────────────────────────────────────────────
describe('POST /api/groups', () => {
  const token = generateAccessToken(TEST_USER_ID);

  it('should create a group with minimal fields', async () => {
    const group = makeGroup();
    // 1. Check group count
    mockQuery.mockResolvedValueOnce(queryResult([{ count: '0' }]));
    // 2. INSERT group
    mockQuery.mockResolvedValueOnce(queryResult([group]));
    // 3. INSERT group_member (admin)
    mockQuery.mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .post('/api/groups')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test Group' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe(group.name);
    expect(res.body.id).toBeDefined();
  });

  it('should create a group with all optional fields', async () => {
    const group = makeGroup({
      category: 'family',
      icon: '👨‍👩‍👧',
      skip_penalty_type: 'avatar_change',
      ai_personality: 'sarcastic',
    });
    mockQuery.mockResolvedValueOnce(queryResult([{ count: '1' }]));
    mockQuery.mockResolvedValueOnce(queryResult([group]));
    mockQuery.mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .post('/api/groups')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Family Group',
        icon: '👨‍👩‍👧',
        category: 'family',
        skip_penalty_type: 'avatar_change',
        ai_personality: 'sarcastic',
      });

    expect(res.status).toBe(201);
  });

  it('should return 403 when user has reached max free groups (3)', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([{ count: '3' }]));

    const res = await request(app)
      .post('/api/groups')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Fourth Group' });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Free tier limited to 3 groups');
  });

  it('should return 400 for missing group name', async () => {
    const res = await request(app)
      .post('/api/groups')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('should return 400 for empty group name', async () => {
    const res = await request(app)
      .post('/api/groups')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '' });

    expect(res.status).toBe(400);
  });

  it('should return 400 for group name exceeding 100 characters', async () => {
    const res = await request(app)
      .post('/api/groups')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'A'.repeat(101) });

    expect(res.status).toBe(400);
  });

  it('should return 400 for invalid category', async () => {
    const res = await request(app)
      .post('/api/groups')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test', category: 'invalid_category' });

    expect(res.status).toBe(400);
  });

  it('should return 400 for invalid penalty type', async () => {
    const res = await request(app)
      .post('/api/groups')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test', skip_penalty_type: 'death_penalty' });

    expect(res.status).toBe(400);
  });

  it('should return 400 for invalid ai_personality', async () => {
    const res = await request(app)
      .post('/api/groups')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Test', ai_personality: 'invalid_personality' });

    expect(res.status).toBe(400);
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app)
      .post('/api/groups')
      .send({ name: 'Test Group' });

    expect(res.status).toBe(401);
  });

  it.each(XSS_PAYLOADS)(
    'should not crash with XSS payload in group name: %s',
    async (payload) => {
      if (payload.length <= 100) {
        mockQuery.mockResolvedValueOnce(queryResult([{ count: '0' }]));
        mockQuery.mockResolvedValueOnce(queryResult([makeGroup({ name: payload })]));
        mockQuery.mockResolvedValueOnce(queryResult([]));

        const res = await request(app)
          .post('/api/groups')
          .set('Authorization', `Bearer ${token}`)
          .send({ name: payload });

        expect([201, 400]).toContain(res.status);
      }
    }
  );
});

// ─────────────────────────────────────────────────────────────────
// GET /api/groups (list user groups)
// ─────────────────────────────────────────────────────────────────
describe('GET /api/groups', () => {
  const token = generateAccessToken(TEST_USER_ID);

  it('should return list of user groups', async () => {
    const groups = [
      { ...makeGroup(), role: 'admin', member_count: 5, has_active_challenge: false, challenge_expires_at: null },
      { ...makeGroup({ id: 'other-group-id', name: 'Other' }), role: 'member', member_count: 3, has_active_challenge: true, challenge_expires_at: new Date(Date.now() + 300000).toISOString() },
    ];
    mockQuery.mockResolvedValueOnce(queryResult(groups));

    const res = await request(app)
      .get('/api/groups')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
  });

  it('should return empty array when user has no groups', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .get('/api/groups')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app).get('/api/groups');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────
// GET /api/groups/:id (group detail)
// ─────────────────────────────────────────────────────────────────
describe('GET /api/groups/:id', () => {
  const token = generateAccessToken(TEST_USER_ID);

  it('should return group details with members and penalties', async () => {
    const membership = makeMembership({ role: 'admin' });
    const group = makeGroup();
    const members = [
      { user_id: TEST_USER_ID, display_name: 'User 1', avatar_url: null, role: 'admin', joined_at: new Date().toISOString(), streak: 5, total_responses: 10, total_challenges: 12, participation_rate: 83 },
    ];
    const penalties: any[] = [];

    mockQuery
      .mockResolvedValueOnce(queryResult([membership]))  // membership check
      .mockResolvedValueOnce(queryResult([group]))        // group info
      .mockResolvedValueOnce(queryResult(members))        // members
      .mockResolvedValueOnce(queryResult(penalties));      // penalties

    const res = await request(app)
      .get(`/api/groups/${TEST_GROUP_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(TEST_GROUP_ID);
    expect(res.body.members).toHaveLength(1);
    expect(res.body.active_penalties).toBeDefined();
  });

  it('should return 403 when user is not a member', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .get(`/api/groups/${TEST_GROUP_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Not a member of this group');
  });

  it('should return 404 when group does not exist', async () => {
    mockQuery
      .mockResolvedValueOnce(queryResult([makeMembership()]))  // membership exists (stale)
      .mockResolvedValueOnce(queryResult([]));                  // group doesn't exist

    const res = await request(app)
      .get(`/api/groups/${TEST_GROUP_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Group not found');
  });
});

// ─────────────────────────────────────────────────────────────────
// POST /api/groups/join
// ─────────────────────────────────────────────────────────────────
describe('POST /api/groups/join', () => {
  const token = generateAccessToken(TEST_USER_ID);

  it('should join a group via valid invite code', async () => {
    const group = makeGroup();
    mockQuery
      .mockResolvedValueOnce(queryResult([{ count: '0' }]))            // user group count
      .mockResolvedValueOnce(queryResult([group]))                      // find by invite_code
      .mockResolvedValueOnce(queryResult([{ count: '5' }]))            // current member count
      .mockResolvedValueOnce(queryResult([]))                           // INSERT group_members
      .mockResolvedValueOnce(queryResult([{ display_name: 'Test' }]))  // joiner name
      .mockResolvedValueOnce(queryResult([]));                          // existing members for notification

    const res = await request(app)
      .post('/api/groups/join')
      .set('Authorization', `Bearer ${token}`)
      .send({ invite_code: TEST_INVITE_CODE });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(TEST_GROUP_ID);
  });

  it('should normalize invite code to uppercase', async () => {
    const group = makeGroup();
    mockQuery
      .mockResolvedValueOnce(queryResult([{ count: '0' }]))
      .mockResolvedValueOnce(queryResult([group]))
      .mockResolvedValueOnce(queryResult([{ count: '5' }]))
      .mockResolvedValueOnce(queryResult([]))
      .mockResolvedValueOnce(queryResult([{ display_name: 'Test' }]))
      .mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .post('/api/groups/join')
      .set('Authorization', `Bearer ${token}`)
      .send({ invite_code: 'abcd1234' });

    expect(res.status).toBe(200);
    // Verify the query was called with uppercased code
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('invite_code'),
      ['ABCD1234']
    );
  });

  it('should return 404 for invalid invite code', async () => {
    mockQuery
      .mockResolvedValueOnce(queryResult([{ count: '0' }]))
      .mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .post('/api/groups/join')
      .set('Authorization', `Bearer ${token}`)
      .send({ invite_code: 'NONEXISTENT' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Invalid invite code');
  });

  it('should return 403 when user has reached max free groups', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([{ count: '3' }]));

    const res = await request(app)
      .post('/api/groups/join')
      .set('Authorization', `Bearer ${token}`)
      .send({ invite_code: TEST_INVITE_CODE });

    expect(res.status).toBe(403);
    expect(res.body.error).toContain('Free tier limited to 3 groups');
  });

  it('should return 400 when group is full', async () => {
    const group = makeGroup({ max_members: 5 });
    mockQuery
      .mockResolvedValueOnce(queryResult([{ count: '0' }]))
      .mockResolvedValueOnce(queryResult([group]))
      .mockResolvedValueOnce(queryResult([{ count: '5' }])); // already at max

    const res = await request(app)
      .post('/api/groups/join')
      .set('Authorization', `Bearer ${token}`)
      .send({ invite_code: TEST_INVITE_CODE });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Group is full');
  });

  it('should return 400 for missing invite_code', async () => {
    const res = await request(app)
      .post('/api/groups/join')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('should return 400 for empty invite_code', async () => {
    const res = await request(app)
      .post('/api/groups/join')
      .set('Authorization', `Bearer ${token}`)
      .send({ invite_code: '' });

    expect(res.status).toBe(400);
  });

  it.each(SQL_INJECTION_PAYLOADS)(
    'should not be vulnerable to SQL injection in invite_code: %s',
    async (payload) => {
      mockQuery
        .mockResolvedValueOnce(queryResult([{ count: '0' }]))
        .mockResolvedValueOnce(queryResult([])); // no group found for injected code

      const res = await request(app)
        .post('/api/groups/join')
        .set('Authorization', `Bearer ${token}`)
        .send({ invite_code: payload });

      // Should either fail validation or return 404 (not found), not crash
      expect([400, 404]).toContain(res.status);
    }
  );
});

// ─────────────────────────────────────────────────────────────────
// POST /api/groups/:id/leave
// ─────────────────────────────────────────────────────────────────
describe('POST /api/groups/:id/leave', () => {
  const token = generateAccessToken(TEST_USER_ID);

  it('should leave group as regular member', async () => {
    mockQuery
      .mockResolvedValueOnce(queryResult([makeMembership({ role: 'member' })]))
      .mockResolvedValueOnce(queryResult([])); // DELETE

    const res = await request(app)
      .post(`/api/groups/${TEST_GROUP_ID}/leave`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Left group successfully');
  });

  it('should delete group when last member (admin) leaves', async () => {
    mockQuery
      .mockResolvedValueOnce(queryResult([makeMembership({ role: 'admin' })]))  // membership
      .mockResolvedValueOnce(queryResult([]))                                     // other members (none)
      .mockResolvedValueOnce(queryResult([]));                                    // DELETE group

    const res = await request(app)
      .post(`/api/groups/${TEST_GROUP_ID}/leave`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toContain('Group was deleted');
  });

  it('should transfer admin role to longest-standing member when admin leaves', async () => {
    const otherMembers = [
      { user_id: TEST_USER_ID_2, role: 'member' },
      { user_id: TEST_USER_ID_3, role: 'member' },
    ];

    mockQuery
      .mockResolvedValueOnce(queryResult([makeMembership({ role: 'admin' })]))     // current membership
      .mockResolvedValueOnce(queryResult(otherMembers))                              // other members
      .mockResolvedValueOnce(queryResult([{ user_id: TEST_USER_ID_2 }]))            // next admin
      .mockResolvedValueOnce(queryResult([]))                                        // UPDATE role
      .mockResolvedValueOnce(queryResult([]));                                       // DELETE member

    const res = await request(app)
      .post(`/api/groups/${TEST_GROUP_ID}/leave`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Left group successfully');
  });

  it('should not transfer admin when other admins exist', async () => {
    const otherMembers = [
      { user_id: TEST_USER_ID_2, role: 'admin' },
      { user_id: TEST_USER_ID_3, role: 'member' },
    ];

    mockQuery
      .mockResolvedValueOnce(queryResult([makeMembership({ role: 'admin' })]))
      .mockResolvedValueOnce(queryResult(otherMembers))
      .mockResolvedValueOnce(queryResult([])); // DELETE member only, no transfer

    const res = await request(app)
      .post(`/api/groups/${TEST_GROUP_ID}/leave`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
  });

  it('should return 404 when user is not a member', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .post(`/api/groups/${TEST_GROUP_ID}/leave`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Not a member of this group');
  });
});

// ─────────────────────────────────────────────────────────────────
// DELETE /api/groups/:id (admin delete)
// ─────────────────────────────────────────────────────────────────
describe('DELETE /api/groups/:id', () => {
  const token = generateAccessToken(TEST_USER_ID);

  it('should delete group as admin', async () => {
    mockQuery
      .mockResolvedValueOnce(queryResult([makeMembership({ role: 'admin' })]))
      .mockResolvedValueOnce(queryResult([{ id: TEST_GROUP_ID }]));

    const res = await request(app)
      .delete(`/api/groups/${TEST_GROUP_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Group deleted successfully');
  });

  it('should return 403 when non-admin tries to delete', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([makeMembership({ role: 'member' })]));

    const res = await request(app)
      .delete(`/api/groups/${TEST_GROUP_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Only group admins can delete a group');
  });

  it('should return 403 when user is not a member', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .delete(`/api/groups/${TEST_GROUP_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Not a member of this group');
  });

  it('should return 404 when group does not exist (race condition)', async () => {
    mockQuery
      .mockResolvedValueOnce(queryResult([makeMembership({ role: 'admin' })]))
      .mockResolvedValueOnce(queryResult([])); // DELETE returns nothing

    const res = await request(app)
      .delete(`/api/groups/${TEST_GROUP_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('should return 401 without authentication', async () => {
    const res = await request(app)
      .delete(`/api/groups/${TEST_GROUP_ID}`);

    expect(res.status).toBe(401);
  });
});
