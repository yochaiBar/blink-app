/**
 * GET /api/device-keys?group_id= — fellow members' active device keys, the
 * input to the app's TOFU pins.
 */
import { query } from '../config/database';
import { useTestServer } from './support/server';
import { addMember, bearer, createGroup, createUser, registerDeviceKey } from './support/factories';

const server = useTestServer();

describe('GET /api/device-keys?group_id=', () => {
  it("lists the group's members' active keys, and nobody else's", async () => {
    const alice = await createUser();
    const bob = await createUser();
    const outsider = await createUser();
    const group = await createGroup({ createdBy: alice, members: [bob] });
    const aliceKey = await registerDeviceKey(alice);
    const bobOld = await registerDeviceKey(bob);
    const bobNew = await registerDeviceKey(bob);
    await query(`UPDATE device_public_keys SET tombstoned_at = NOW() WHERE device_id = $1`, [bobOld.deviceId]);
    await registerDeviceKey(outsider);

    const res = await server.api().get(`/api/device-keys?group_id=${group.id}`).set(bearer(bob));

    expect(res.status).toBe(200);
    expect(res.body.v).toBe(1);
    const byUser = Object.fromEntries(
      res.body.keys.map((k: { user_id: string; x25519_public_key_b64: string }) => [k.user_id, k]),
    );
    expect(Object.keys(byUser).sort()).toEqual([alice.id, bob.id].sort());
    expect(byUser[alice.id]).toMatchObject({
      v: 1,
      device_id: aliceKey.deviceId,
      x25519_public_key_b64: aliceKey.publicKeyB64,
      tombstoned_at: null,
    });
    expect(byUser[bob.id]).toMatchObject({ device_id: bobNew.deviceId });
  });

  it('is for members only and needs a valid group id', async () => {
    const alice = await createUser();
    const stranger = await createUser();
    const group = await createGroup({ createdBy: alice });
    await addMember(group.id, (await createUser()).id);

    expect((await server.api().get(`/api/device-keys?group_id=${group.id}`).set(bearer(stranger))).status).toBe(403);
    expect((await server.api().get('/api/device-keys?group_id=nope').set(bearer(alice))).status).toBe(400);
    expect((await server.api().get('/api/device-keys').set(bearer(alice))).status).toBe(400);
  });
});
