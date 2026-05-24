/**
 * Photo Comments Route Tests - blink-server
 *
 * Covers POST/GET/DELETE for `/api/challenges/responses/:responseId/comments`
 * and `/api/challenges/comments/:commentId`.
 *
 * See ~/Documents/Obsidian Vault/Blink/Plans/Photo comments.md for design.
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
  makeMembership,
  queryResult,
} from './helpers';

import './setup';

import challengeRouter from '../routes/challenges';
import { query } from '../config/database';
import { emitToGroup } from '../socket';
import { sendPushToUser } from '../services/pushNotifications';

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockEmit = emitToGroup as jest.MockedFunction<typeof emitToGroup>;
const mockPush = sendPushToUser as jest.MockedFunction<typeof sendPushToUser>;
const app = createTestApp(challengeRouter, '/api/challenges');

const TEST_COMMENT_ID = 'a8b9c0d1-e2f3-4a4b-8c5d-6e7f8a9b0c1d';
const TEST_PARENT_COMMENT_ID = 'b9c0d1e2-f3a4-4b5c-9d6e-7f8a9b0c1d2e';

function makeResponseContext(overrides: Record<string, unknown> = {}) {
  return {
    response_user_id: TEST_USER_ID_2,
    challenge_id: TEST_CHALLENGE_ID,
    group_id: TEST_GROUP_ID,
    ...overrides,
  };
}

function makeComment(overrides: Record<string, unknown> = {}) {
  return {
    id: TEST_COMMENT_ID,
    response_id: TEST_RESPONSE_ID,
    user_id: TEST_USER_ID,
    parent_comment_id: null,
    text: 'nice shot',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────
// POST /api/challenges/responses/:responseId/comments
// ─────────────────────────────────────────────────────────────────
describe('POST /api/challenges/responses/:responseId/comments', () => {
  const token = generateAccessToken(TEST_USER_ID);

  it('creates a top-level comment, emits socket event, pushes to photo owner', async () => {
    mockQuery
      .mockResolvedValueOnce(queryResult([makeResponseContext()]))      // loadResponseContext
      .mockResolvedValueOnce(queryResult([makeMembership()]))           // isGroupMember
      .mockResolvedValueOnce(queryResult([makeComment()]))              // INSERT comment
      .mockResolvedValueOnce(queryResult([{ display_name: 'Tester' }])); // getDisplayName

    const res = await request(app)
      .post(`/api/challenges/responses/${TEST_RESPONSE_ID}/comments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'nice shot' });

    expect(res.status).toBe(201);
    expect(res.body.text).toBe('nice shot');
    expect(res.body.parent_comment_id).toBeNull();

    expect(mockEmit).toHaveBeenCalledWith(
      TEST_GROUP_ID,
      'comment:created',
      expect.objectContaining({ response_id: TEST_RESPONSE_ID }),
    );
    expect(mockPush).toHaveBeenCalledWith(
      TEST_USER_ID_2,
      'New comment',
      expect.stringContaining('commented on your photo'),
      expect.objectContaining({ type: 'comment' }),
    );
  });

  it('creates a reply to a valid top-level comment and notifies the parent author', async () => {
    const parent = makeComment({
      id: TEST_PARENT_COMMENT_ID,
      user_id: TEST_USER_ID_2,
      parent_comment_id: null,
      response_id: TEST_RESPONSE_ID,
    });
    const reply = makeComment({
      id: TEST_COMMENT_ID,
      parent_comment_id: TEST_PARENT_COMMENT_ID,
      text: 'agreed',
    });

    mockQuery
      .mockResolvedValueOnce(queryResult([makeResponseContext()]))      // loadResponseContext
      .mockResolvedValueOnce(queryResult([makeMembership()]))           // isGroupMember
      .mockResolvedValueOnce(queryResult([parent]))                     // parent lookup
      .mockResolvedValueOnce(queryResult([reply]))                      // INSERT reply
      .mockResolvedValueOnce(queryResult([{ display_name: 'Tester' }])) // getDisplayName
      .mockResolvedValueOnce(queryResult([{ user_id: TEST_USER_ID_2 }])); // parent author for push

    const res = await request(app)
      .post(`/api/challenges/responses/${TEST_RESPONSE_ID}/comments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'agreed', parent_comment_id: TEST_PARENT_COMMENT_ID });

    expect(res.status).toBe(201);
    expect(res.body.parent_comment_id).toBe(TEST_PARENT_COMMENT_ID);
    expect(mockPush).toHaveBeenCalledWith(
      TEST_USER_ID_2,
      'New reply',
      expect.stringContaining('replied to your comment'),
      expect.objectContaining({ type: 'comment_reply' }),
    );
  });

  it('rejects a reply-to-reply (1-level threading)', async () => {
    const parent = makeComment({
      id: TEST_PARENT_COMMENT_ID,
      parent_comment_id: 'some-other-comment-id',  // already a reply
      response_id: TEST_RESPONSE_ID,
    });

    mockQuery
      .mockResolvedValueOnce(queryResult([makeResponseContext()]))
      .mockResolvedValueOnce(queryResult([makeMembership()]))
      .mockResolvedValueOnce(queryResult([parent]));

    const res = await request(app)
      .post(`/api/challenges/responses/${TEST_RESPONSE_ID}/comments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'nope', parent_comment_id: TEST_PARENT_COMMENT_ID });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/nested beyond one level/);
  });

  it('rejects a reply when the parent belongs to a different response', async () => {
    const parent = makeComment({
      id: TEST_PARENT_COMMENT_ID,
      response_id: 'b1c2d3e4-f5a6-4b7c-8d9e-0a1b2c3d4e5f',
      parent_comment_id: null,
    });

    mockQuery
      .mockResolvedValueOnce(queryResult([makeResponseContext()]))
      .mockResolvedValueOnce(queryResult([makeMembership()]))
      .mockResolvedValueOnce(queryResult([parent]));

    const res = await request(app)
      .post(`/api/challenges/responses/${TEST_RESPONSE_ID}/comments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'oops', parent_comment_id: TEST_PARENT_COMMENT_ID });

    expect(res.status).toBe(400);
  });

  it('returns 404 when parent comment is missing or deleted', async () => {
    mockQuery
      .mockResolvedValueOnce(queryResult([makeResponseContext()]))
      .mockResolvedValueOnce(queryResult([makeMembership()]))
      .mockResolvedValueOnce(queryResult([]));  // parent not found

    const res = await request(app)
      .post(`/api/challenges/responses/${TEST_RESPONSE_ID}/comments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'orphan reply', parent_comment_id: TEST_PARENT_COMMENT_ID });

    expect(res.status).toBe(404);
  });

  it('returns 404 when the response does not exist', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .post(`/api/challenges/responses/${TEST_RESPONSE_ID}/comments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'hello' });

    expect(res.status).toBe(404);
  });

  it('returns 403 when user is not a group member', async () => {
    mockQuery
      .mockResolvedValueOnce(queryResult([makeResponseContext()]))
      .mockResolvedValueOnce(queryResult([]));  // no membership

    const res = await request(app)
      .post(`/api/challenges/responses/${TEST_RESPONSE_ID}/comments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'hello' });

    expect(res.status).toBe(403);
  });

  it('returns 400 for empty text', async () => {
    const res = await request(app)
      .post(`/api/challenges/responses/${TEST_RESPONSE_ID}/comments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ text: '' });

    expect(res.status).toBe(400);
  });

  it('returns 400 for text > 280 chars', async () => {
    const res = await request(app)
      .post(`/api/challenges/responses/${TEST_RESPONSE_ID}/comments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'a'.repeat(281) });

    expect(res.status).toBe(400);
  });

  it('does not push to commenter when commenting on own photo', async () => {
    mockQuery
      .mockResolvedValueOnce(queryResult([makeResponseContext({ response_user_id: TEST_USER_ID })]))
      .mockResolvedValueOnce(queryResult([makeMembership()]))
      .mockResolvedValueOnce(queryResult([makeComment()]))
      .mockResolvedValueOnce(queryResult([{ display_name: 'Tester' }]));

    const res = await request(app)
      .post(`/api/challenges/responses/${TEST_RESPONSE_ID}/comments`)
      .set('Authorization', `Bearer ${token}`)
      .send({ text: 'self comment' });

    expect(res.status).toBe(201);
    expect(mockPush).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────
// GET /api/challenges/responses/:responseId/comments
// ─────────────────────────────────────────────────────────────────
describe('GET /api/challenges/responses/:responseId/comments', () => {
  const token = generateAccessToken(TEST_USER_ID);

  it('lists all comments for a response (member of group)', async () => {
    const comments = [
      { ...makeComment(), display_name: 'Alice', avatar_url: null },
      { ...makeComment({ id: 'c-2', text: 'second' }), display_name: 'Bob', avatar_url: null },
    ];

    mockQuery
      .mockResolvedValueOnce(queryResult([makeResponseContext()]))
      .mockResolvedValueOnce(queryResult([makeMembership()]))
      .mockResolvedValueOnce(queryResult(comments));

    const res = await request(app)
      .get(`/api/challenges/responses/${TEST_RESPONSE_ID}/comments`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].display_name).toBe('Alice');
  });

  it('returns 403 when not a group member', async () => {
    mockQuery
      .mockResolvedValueOnce(queryResult([makeResponseContext()]))
      .mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .get(`/api/challenges/responses/${TEST_RESPONSE_ID}/comments`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('returns 404 when response does not exist', async () => {
    mockQuery.mockResolvedValueOnce(queryResult([]));

    const res = await request(app)
      .get(`/api/challenges/responses/${TEST_RESPONSE_ID}/comments`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────
// DELETE /api/challenges/comments/:commentId
// ─────────────────────────────────────────────────────────────────
describe('DELETE /api/challenges/comments/:commentId', () => {
  const token = generateAccessToken(TEST_USER_ID);

  it('soft-deletes own comment and emits socket event', async () => {
    mockQuery.mockResolvedValueOnce(
      queryResult([{ ...makeComment(), deleted_at: new Date().toISOString(), group_id: TEST_GROUP_ID }]),
    );

    const res = await request(app)
      .delete(`/api/challenges/comments/${TEST_COMMENT_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(mockEmit).toHaveBeenCalledWith(
      TEST_GROUP_ID,
      'comment:deleted',
      expect.objectContaining({ comment_id: TEST_COMMENT_ID }),
    );
  });

  it('returns 403 when not the comment owner', async () => {
    mockQuery
      .mockResolvedValueOnce(queryResult([]))                                  // UPDATE returned nothing
      .mockResolvedValueOnce(queryResult([{ user_id: TEST_USER_ID_2 }]));      // SELECT shows someone else owns it

    const res = await request(app)
      .delete(`/api/challenges/comments/${TEST_COMMENT_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('returns 404 when comment does not exist', async () => {
    mockQuery
      .mockResolvedValueOnce(queryResult([]))   // UPDATE: nothing
      .mockResolvedValueOnce(queryResult([]));  // SELECT: nothing

    const res = await request(app)
      .delete(`/api/challenges/comments/${TEST_COMMENT_ID}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });
});
