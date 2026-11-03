/**
 * Reactions on responses, and how blocks hide them.
 */
import { useTestServer } from './support/server';
import { pushRequests } from './support/httpStubs';
import {
  bearer,
  block,
  countRows,
  createChallenge,
  createGroup,
  createReaction,
  createResponse,
  createUser,
  setPushToken,
  waitForPush,
} from './support/factories';

const server = useTestServer();

const reactionsUrl = (responseId: string) => `/api/challenges/responses/${responseId}/reactions`;

async function scene() {
  const owner = await createUser();
  const friend = await createUser();
  const group = await createGroup({ createdBy: owner, members: [friend] });
  const challenge = await createChallenge({ groupId: group.id, createdBy: owner });
  const response = await createResponse({ challengeId: challenge.id, user: owner });
  return { owner, friend, group, challenge, response };
}

describe('reactions', () => {
  it('adds a reaction once, pushes to the owner, and removes it', async () => {
    const { owner, friend, response } = await scene();
    const ownerToken = await setPushToken(owner);

    const added = await server.api().post(reactionsUrl(response.id)).set(bearer(friend)).send({ emoji: '🔥' });
    expect(added.status).toBe(201);
    await waitForPush((tokens) => tokens.includes(ownerToken), pushRequests);

    const dup = await server.api().post(reactionsUrl(response.id)).set(bearer(friend)).send({ emoji: '🔥' });
    expect(dup.status).toBe(409);

    const removed = await server
      .api()
      .delete(`${reactionsUrl(response.id)}/${encodeURIComponent('🔥')}`)
      .set(bearer(friend));
    expect(removed.status).toBe(200);
    const again = await server
      .api()
      .delete(`${reactionsUrl(response.id)}/${encodeURIComponent('🔥')}`)
      .set(bearer(friend));
    expect(again.status).toBe(404);
  });

  it('requires membership and an existing response', async () => {
    const { response } = await scene();
    const stranger = await createUser();

    expect(
      (await server.api().post(reactionsUrl(response.id)).set(bearer(stranger)).send({ emoji: '🔥' })).status,
    ).toBe(403);
    const missing = '00000000-0000-4000-8000-000000000000';
    expect((await server.api().post(reactionsUrl(missing)).set(bearer(stranger)).send({ emoji: '🔥' })).status).toBe(
      404,
    );
    expect((await server.api().post(reactionsUrl(response.id)).set(bearer(stranger)).send({})).status).toBe(400);
  });

  it("can't react to a blocked user's photo, and doesn't see their reactions", async () => {
    const { owner, friend, challenge, response } = await scene();
    await createReaction({ responseId: response.id, user: friend, emoji: '😂' });
    const friendsPhoto = await createResponse({ challengeId: challenge.id, user: friend });
    await block(owner, friend);

    const attempt = await server.api().post(reactionsUrl(friendsPhoto.id)).set(bearer(owner)).send({ emoji: '🔥' });
    expect(attempt.status).toBe(404);
    expect(await countRows('SELECT COUNT(*) FROM reactions WHERE response_id = $1', [friendsPhoto.id])).toBe(0);

    // The owner's own photo shows no reactions from the blocked friend…
    const list = await server.api().get(`/api/challenges/${challenge.id}`).set(bearer(owner));
    expect(list.status).toBe(200);
    expect(list.body.responses.map((r: { user_id: string }) => r.user_id)).toEqual([owner.id]);
    expect(list.body.responses[0].reactions).toEqual([]);
  });
});
