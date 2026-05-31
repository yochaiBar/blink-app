/**
 * End-to-end courier handshake test — exercises the real noble crypto
 * round-trip across two "devices" so a regression in either
 * courierEncryptGroupKey or joinerDecryptGroupKey would fail here.
 *
 * No socket or HTTP transport is involved; the test simulates the
 * server's role (lookup joiner pubkey + forward opaque envelope) by
 * calling the two helpers directly with a freshly-generated group key.
 */

import './setup';

// Stateful secure-store backing so each "device" gets its own keypair.
const ssA = new Map<string, string>();
const ssB = new Map<string, string>();
let currentSs: Map<string, string> = ssA;

import * as SecureStore from 'expo-secure-store';

import {
  bytesToB64,
  b64ToBytes,
  courierEncryptGroupKey,
  joinerDecryptGroupKey,
  newGroupKey,
  getOrCreateDeviceKey,
  clearDeviceKey,
} from '../services/groupCrypto';

beforeEach(() => {
  ssA.clear();
  ssB.clear();
  currentSs = ssA;
  (SecureStore.getItemAsync as jest.Mock).mockImplementation(
    async (k: string) => currentSs.get(k) ?? null,
  );
  (SecureStore.setItemAsync as jest.Mock).mockImplementation(
    async (k: string, v: string) => {
      currentSs.set(k, v);
    },
  );
  (SecureStore.deleteItemAsync as jest.Mock).mockImplementation(
    async (k: string) => {
      currentSs.delete(k);
    },
  );
});

describe('courier handshake — end-to-end across two simulated devices', () => {
  it('joiner recovers the same group key the courier encrypted', async () => {
    // Alice (courier) — first "device"
    currentSs = ssA;
    const aliceDevice = await getOrCreateDeviceKey();
    const groupKey = newGroupKey();

    // Bob (joiner) — second "device"
    currentSs = ssB;
    await clearDeviceKey(); // fresh device
    const bobDevice = await getOrCreateDeviceKey();

    // Server's role: hand Bob's public key (base64) to Alice's
    // keyshare_request handler.
    const bobPubB64 = bytesToB64(bobDevice.publicKey);

    // Alice (back to her secure-store)
    currentSs = ssA;
    const envelope = courierEncryptGroupKey(b64ToBytes(bobPubB64), groupKey);

    // Wire transit — serialize, transmit, deserialize.
    const wire = {
      ephemeral_public_key_b64: bytesToB64(envelope.ephemeralPublicKey),
      iv_b64: bytesToB64(envelope.iv),
      ciphertext_b64: bytesToB64(envelope.ciphertext),
    };

    // Bob's role
    currentSs = ssB;
    const recovered = joinerDecryptGroupKey(
      bobDevice.privateScalar,
      bobDevice.publicKey,
      {
        ephemeralPublicKey: b64ToBytes(wire.ephemeral_public_key_b64),
        iv: b64ToBytes(wire.iv_b64),
        ciphertext: b64ToBytes(wire.ciphertext_b64),
      },
    );

    expect(recovered).toEqual(groupKey);
    // Sanity: Alice's device is unrelated to the recovery — Bob did it
    // with his own private key.
    expect(aliceDevice.device_id).not.toBe(bobDevice.device_id);
  });

  it('fails closed when the server tries to substitute the joiner public key (H1 MITM)', async () => {
    currentSs = ssA;
    const groupKey = newGroupKey();

    currentSs = ssB;
    await clearDeviceKey();
    const bobDevice = await getOrCreateDeviceKey();

    // Malicious server substitutes a different public key when relaying
    // to Alice. Alice encrypts to the attacker's key, not Bob's.
    currentSs = ssA;
    await clearDeviceKey();
    const attackerKeyMaterial = await getOrCreateDeviceKey();

    const envelope = courierEncryptGroupKey(
      attackerKeyMaterial.publicKey,
      groupKey,
    );

    // Bob's device receives. Salt input uses HIS pub key, not the
    // attacker's. HKDF derives a different AEAD key. Decrypt throws.
    expect(() =>
      joinerDecryptGroupKey(bobDevice.privateScalar, bobDevice.publicKey, envelope),
    ).toThrow();
  });

  it('rejects an envelope whose ciphertext was tampered in transit', async () => {
    currentSs = ssB;
    await clearDeviceKey();
    const bobDevice = await getOrCreateDeviceKey();

    currentSs = ssA;
    const groupKey = newGroupKey();
    const envelope = courierEncryptGroupKey(bobDevice.publicKey, groupKey);

    // Flip a bit in the ciphertext.
    const tampered = new Uint8Array(envelope.ciphertext);
    tampered[0] ^= 0x01;

    currentSs = ssB;
    expect(() =>
      joinerDecryptGroupKey(bobDevice.privateScalar, bobDevice.publicKey, {
        ephemeralPublicKey: envelope.ephemeralPublicKey,
        iv: envelope.iv,
        ciphertext: tampered,
      }),
    ).toThrow();
  });
});
