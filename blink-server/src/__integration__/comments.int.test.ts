/**
 * Photo comments: threading rules, membership, notifications and blocks.
 */
import { query } from '../config/database';
import { useTestServer } from './support/server';
import { pushRequests } from './support/httpStubs';
import {
  bearer,
  block,
  createChallenge,
  createComment,
  createGroup,
  createResponse,
  createUser,
  setPushToken,
  waitForPush,
} from './support/factories';

const server = useTestServer();

async function scene() {
  const owner = await createUser({ display_name: 'Owner' });
  const friend = await createUser({ display_name: 'Friend' });
  const group = await createGroup({ createdBy: owner, members: [friend] });
  const challenge = await createChallenge({ groupId: group.id, createdBy: owner });
  const response = await createResponse({ challengeId: challenge.id, user: owner });
  return { owner, friend, group, challenge, response };
}

const commentsUrl = (responseId: string) => `/api/challenges/responses/${responseId}/comments`;

describe('comments', () => {
  it('creates a top-level comment, emits it to the group and pushes to the photo owner', async () => {
    const { owner, friend, response } = await scene();
    const ownerToken = await setPushToken(owner);
    const ownerSocket = await server.connectSocket(owner.token);
    const emitted = new Promise<{ comment: { text: string } }>((resolve) =>
      ownerSocket.once('comment:created', resolve),
    );

    const res = await server.api().post(commentsUrl(response.id)).set(bearer(friend)).send({ text: '  great shot ' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ response_id: response.id, user_id: friend.id, text: 'great shot' });
    expect((await emitted).comment.text).toBe('great shot');
    await waitForPush((tokens) => tokens.includes(ownerToken), pushRequests);
  });

  it('replies notify the parent author; replies to replies are rejected', async () => {
    const { owner, friend, response } = await scene();
    const parent = await createComment({ responseId: response.id, user: friend });
    const friendToken = await setPushToken(friend);

    const reply = await server
      .api()
      .post(commentsUrl(response.id))
      .set(bearer(owner))
      .send({ text: 'thanks', parent_comment_id: parent.id });
    expect(reply.status).toBe(201);
    await waitForPush((tokens) => tokens.includes(friendToken), pushRequests);

    const nested = await server
      .api()
      .post(commentsUrl(response.id))
      .set(bearer(friend))
      .send({ text: 'nested', parent_comment_id: reply.body.id });
    expect(nested.status).toBe(400);
  });

  it('rejects a parent from another response and a missing parent', async () => {
    const { owner, friend, challenge, response } = await scene();
    const other = await createResponse({ challengeId: challenge.id, user: friend });
    const otherComment = await createComment({ responseId: other.id, user: friend });

    const wrong = await server
      .api()
      .post(commentsUrl(response.id))
      .set(bearer(owner))
      .send({ text: 'x', parent_comment_id: otherComment.id });
    expect(wrong.status).toBe(400);

    const missing = await server
      .api()
      .post(commentsUrl(response.id))
      .set(bearer(owner))
      .send({ text: 'x', parent_comment_id: '00000000-0000-4000-8000-000000000000' });
    expect(missing.status).toBe(404);
  });

  it('requires membership, an existing response and a valid id', async () => {
    const { response } = await scene();
    const stranger = await createUser();

    expect((await server.api().post(commentsUrl(response.id)).set(bearer(stranger)).send({ text: 'hi' })).status).toBe(
      403,
    );
    expect((await server.api().get(commentsUrl(response.id)).set(bearer(stranger))).status).toBe(403);
    const missing = '00000000-0000-4000-8000-000000000000';
    expect((await server.api().get(commentsUrl(missing)).set(bearer(stranger))).status).toBe(404);
    const bad = await server.api().get(commentsUrl('not-a-uuid')).set(bearer(stranger));
    expect(bad.status).toBe(400);
    expect(bad.body).toEqual({ error: 'Invalid responseId format' });
  });

  it('does not push to the commenter on their own photo', async () => {
    const { owner, response } = await scene();
    await setPushToken(owner);

    const res = await server.api().post(commentsUrl(response.id)).set(bearer(owner)).send({ text: 'me' });

    expect(res.status).toBe(201);
    expect(pushRequests).toHaveLength(0);
  });

  it('lists comments and soft-deletes only your own', async () => {
    const { owner, friend, response } = await scene();
    const mine = await createComment({ responseId: response.id, user: friend, text: 'mine' });
    const theirs = await createComment({ responseId: response.id, user: owner, text: 'theirs' });

    const list = await server.api().get(commentsUrl(response.id)).set(bearer(friend));
    expect(list.status).toBe(200);
    expect(list.body.map((c: { text: string }) => c.text)).toEqual(['mine', 'theirs']);
    expect(list.body[0]).toMatchObject({ display_name: 'Friend' });

    expect((await server.api().delete(`/api/challenges/comments/${theirs.id}`).set(bearer(friend))).status).toBe(403);
    expect((await server.api().delete(`/api/challenges/comments/${mine.id}`).set(bearer(friend))).status).toBe(200);
    expect((await server.api().delete(`/api/challenges/comments/${mine.id}`).set(bearer(friend))).status).toBe(404);
    const after = await server.api().get(commentsUrl(response.id)).set(bearer(owner));
    expect(after.body.map((c: { text: string }) => c.text)).toEqual(['theirs']);
  });

  it('hides comments between blocked users, and blocks commenting on their photos', async () => {
    const { owner, friend, group, response } = await scene();
    const blocker = await createUser();
    await query(`INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)`, [group.id, blocker.id]);
    await createComment({ responseId: response.id, user: friend, text: 'from friend' });
    await block(blocker, friend);

    const seenByBlocker = await server.api().get(commentsUrl(response.id)).set(bearer(blocker));
    expect(seenByBlocker.body).toEqual([]);
    const seenByOwner = await server.api().get(commentsUrl(response.id)).set(bearer(owner));
    expect(seenByOwner.body).toHaveLength(1);

    const friendsPhoto = await createResponse({ challengeId: response.challenge_id, user: friend });
    const attempt = await server.api().post(commentsUrl(friendsPhoto.id)).set(bearer(blocker)).send({ text: 'hi' });
    expect(attempt.status).toBe(404);
  });
});
