/**
 * Smoke tests: the main happy paths against real Postgres, the real
 * authenticate middleware and a real Socket.io server.
 */
import { query } from '../config/database';
import { useTestServer } from './support/server';
import { bearer, countRows, createGroup, createUser } from './support/factories';

const server = useTestServer();

describe('smoke', () => {
  it('GET /api/health reports the database as ok', async () => {
    const res = await server.api().get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', checks: { server: 'ok', database: 'ok' } });
  });

  it('dev-mode OTP login issues an access token the API accepts', async () => {
    const phone = '+15550001234';

    const otp = await server.api().post('/api/auth/request-otp').send({ phone_number: phone });
    expect(otp.status).toBe(200);
    expect(otp.body.dev_hint).toBe('Use 123456');

    const verify = await server.api().post('/api/auth/verify-otp').send({ phone_number: phone, code: '123456' });
    expect(verify.status).toBe(200);
    expect(verify.body.user.phone_number).toBe(phone);
    expect(typeof verify.body.access_token).toBe('string');
    expect(typeof verify.body.refresh_token).toBe('string');

    const me = await server.api().get('/api/auth/me').set('Authorization', `Bearer ${verify.body.access_token}`);
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(verify.body.user.id);

    // The consumed OTP is gone from the database.
    expect(await countRows('SELECT COUNT(*) FROM otp_codes WHERE phone = $1', [phone])).toBe(0);
  });

  it('rejects a wrong OTP code', async () => {
    const phone = '+15550004321';
    await server.api().post('/api/auth/request-otp').send({ phone_number: phone });

    const verify = await server.api().post('/api/auth/verify-otp').send({ phone_number: phone, code: '000000' });

    expect(verify.status).toBe(401);
    expect(await countRows('SELECT COUNT(*) FROM users WHERE phone_number = $1', [phone])).toBe(0);
  });

  it('POST /api/groups creates the group with its creator as admin', async () => {
    const alice = await createUser();

    const res = await server.api().post('/api/groups').set(bearer(alice)).send({ name: 'Climbing crew' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Climbing crew');
    const members = await query('SELECT user_id, role FROM group_members WHERE group_id = $1', [res.body.id]);
    expect(members.rows).toEqual([{ user_id: alice.id, role: 'admin' }]);
  });

  it('POST /api/groups/join adds the member and notifies the group over Socket.io', async () => {
    const alice = await createUser({ display_name: 'Alice' });
    const bob = await createUser({ display_name: 'Bob' });
    const group = await createGroup({ createdBy: alice });

    const aliceSocket = await server.connectSocket(alice.token);
    await server.waitForRoomSize(`group:${group.id}`, 1);
    const joined = new Promise<{ groupId: string; userId: string; displayName: string }>((resolve) => {
      aliceSocket.once('group:member-joined', resolve);
    });

    const res = await server.api().post('/api/groups/join').set(bearer(bob)).send({ invite_code: group.invite_code });

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(group.id);
    expect(await joined).toEqual({ groupId: group.id, userId: bob.id, displayName: 'Bob' });
    expect(await countRows('SELECT COUNT(*) FROM group_members WHERE group_id = $1', [group.id])).toBe(2);
    expect(
      await countRows(`SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND type = 'group_joined'`, [alice.id]),
    ).toBe(1);
  });

  it('a member can start a challenge and another member can respond to it', async () => {
    const alice = await createUser();
    const bob = await createUser();
    const group = await createGroup({ createdBy: alice, members: [bob] });

    const created = await server
      .api()
      .post(`/api/challenges/groups/${group.id}/challenges`)
      .set(bearer(alice))
      .send({ type: 'snap' });
    expect(created.status).toBe(201);
    expect(created.body.status).toBe('active');

    const responded = await server
      .api()
      .post(`/api/challenges/${created.body.id}/respond`)
      .set(bearer(bob))
      .send({ has_photo: true });
    expect(responded.status).toBe(201);
    expect(responded.body).toMatchObject({ challenge_id: created.body.id, user_id: bob.id, has_photo: true });

    const active = await server.api().get(`/api/challenges/groups/${group.id}/challenges/active`).set(bearer(bob));
    expect(active.status).toBe(200);
    expect(active.body.id).toBe(created.body.id);
  });

  it('rejects requests without a valid token', async () => {
    const res = await server.api().get('/api/groups');

    expect(res.status).toBe(401);
  });
});
