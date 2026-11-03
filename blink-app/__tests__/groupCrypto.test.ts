/**
 * Crypto round-trip + tamper-detection tests for the E2E photo flow.
 *
 * These exercise the REAL `@noble/*` primitives, not the mock in setup.ts —
 * the value of these tests is exactly that they catch bad call sites that
 * a mock would gloss over. We unmock at the top of this file.
 */

// expo-secure-store stays mocked from setup.ts — we want device-key persistence
// to be observable via the mock, not actually hit the device keychain. The
// global noble mock was removed from setup.ts so these tests use the real
// AES-GCM and X25519 primitives (the whole point of having them).
import './setup';

import {
  aadBytes,
  aesGcmDecrypt,
  aesGcmEncrypt,
  b64ToBytes,
  bytesToB64,
  computeAttestation,
  courierEncryptGroupKey,
  joinerDecryptGroupKey,
  newGroupKey,
} from '../services/groupCrypto';
import { x25519 } from '@noble/curves/ed25519.js';
import { randomBytes } from '@noble/ciphers/utils.js';
import { createHmac } from 'node:crypto';
import { photoAad } from '../shared/photoProtocol';

const AAD = aadBytes(
  photoAad({
    groupId: '11111111-1111-4111-8111-111111111111',
    challengeId: '22222222-2222-4222-8222-222222222222',
    responseId: '33333333-3333-4333-8333-333333333333',
    senderUserId: '44444444-4444-4444-8444-444444444444',
    keyVersion: 1,
  }),
);

const CTX = {
  groupId: '11111111-1111-4111-8111-111111111111',
  joinerUserId: '55555555-5555-4555-8555-555555555555',
  joinerDeviceId: '66666666-6666-4666-8666-666666666666',
  keyVersion: 1,
};

describe('groupCrypto — base64 round-trip', () => {
  it('encodes and decodes arbitrary bytes', () => {
    const bytes = randomBytes(32);
    expect(b64ToBytes(bytesToB64(bytes))).toEqual(bytes);
  });

  it('encodes 32 random bytes to 44 base64 chars', () => {
    const b64 = bytesToB64(randomBytes(32));
    expect(b64.length).toBe(44);
    expect(b64).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
});

describe('groupCrypto — AES-256-GCM', () => {
  it('round-trips plaintext through encrypt + decrypt', () => {
    const key = newGroupKey();
    const plaintext = new TextEncoder().encode('hello world');
    const blob = aesGcmEncrypt(key, plaintext, AAD);
    const recovered = aesGcmDecrypt(key, blob, AAD);
    expect(new TextDecoder().decode(recovered)).toBe('hello world');
  });

  it('generates a fresh random IV every call (H2 guard)', () => {
    const key = newGroupKey();
    const plaintext = new TextEncoder().encode('same input every time');
    const a = aesGcmEncrypt(key, plaintext, AAD);
    const b = aesGcmEncrypt(key, plaintext, AAD);
    // The whole point: two encrypts of the same plaintext under the same key
    // must produce different IVs and therefore different ciphertexts.
    expect(a.iv).not.toEqual(b.iv);
    expect(a.ciphertext).not.toEqual(b.ciphertext);
  });

  it('uses a 12-byte IV', () => {
    const key = newGroupKey();
    const blob = aesGcmEncrypt(key, new Uint8Array([1, 2, 3]), AAD);
    expect(blob.iv.length).toBe(12);
  });

  it('ciphertext is plaintext.length + 16-byte tag', () => {
    const key = newGroupKey();
    const plaintext = new Uint8Array(100);
    const blob = aesGcmEncrypt(key, plaintext, AAD);
    expect(blob.ciphertext.length).toBe(100 + 16);
  });

  it('fails closed on auth-tag failure (tampered ciphertext)', () => {
    const key = newGroupKey();
    const plaintext = new TextEncoder().encode('do not tamper');
    const blob = aesGcmEncrypt(key, plaintext, AAD);
    // Flip a bit in the ciphertext body.
    blob.ciphertext[0] ^= 0x01;
    expect(() => aesGcmDecrypt(key, blob, AAD)).toThrow();
  });

  it('fails closed when the associated data differs', () => {
    const key = newGroupKey();
    const blob = aesGcmEncrypt(key, new TextEncoder().encode('bound'), AAD);
    expect(() => aesGcmDecrypt(key, blob, aadBytes('blink/photo/v2|other'))).toThrow();
    expect(() => aesGcmDecrypt(key, blob, new Uint8Array(0))).toThrow();
  });

  it('fails closed when decrypting with the wrong key', () => {
    const keyA = newGroupKey();
    const keyB = newGroupKey();
    const blob = aesGcmEncrypt(keyA, new TextEncoder().encode('secret'), AAD);
    expect(() => aesGcmDecrypt(keyB, blob, AAD)).toThrow();
  });

  it('rejects keys of the wrong length', () => {
    const shortKey = new Uint8Array(16);
    expect(() => aesGcmEncrypt(shortKey, new Uint8Array([1]), AAD)).toThrow(/32 bytes/);
    expect(() => aesGcmDecrypt(shortKey, { iv: new Uint8Array(12), ciphertext: new Uint8Array(17) }, AAD)).toThrow(
      /32 bytes/,
    );
  });

  it('rejects ciphertext shorter than the GCM tag', () => {
    const key = newGroupKey();
    expect(() => aesGcmDecrypt(key, { iv: new Uint8Array(12), ciphertext: new Uint8Array(8) }, AAD)).toThrow(/GCM tag/);
  });
});

describe('groupCrypto — courier handshake', () => {
  it('round-trips a group key from courier to joiner', () => {
    const joinerPriv = randomBytes(32);
    const joinerPub = x25519.getPublicKey(joinerPriv);
    const groupKey = newGroupKey();

    const envelope = courierEncryptGroupKey(joinerPub, groupKey, CTX);
    const recovered = joinerDecryptGroupKey(joinerPriv, joinerPub, envelope, CTX);

    expect(recovered).toEqual(groupKey);
  });

  it('produces a fresh ephemeral keypair on every handshake', () => {
    const joinerPriv = randomBytes(32);
    const joinerPub = x25519.getPublicKey(joinerPriv);
    const groupKey = newGroupKey();

    const a = courierEncryptGroupKey(joinerPub, groupKey, CTX);
    const b = courierEncryptGroupKey(joinerPub, groupKey, CTX);
    expect(a.ephemeralPublicKey).not.toEqual(b.ephemeralPublicKey);
    expect(a.iv).not.toEqual(b.iv);
    expect(a.ciphertext).not.toEqual(b.ciphertext);
  });

  it("fails closed when the joiner's static private key is wrong", () => {
    const joinerPriv = randomBytes(32);
    const joinerPub = x25519.getPublicKey(joinerPriv);
    const attackerPriv = randomBytes(32);
    const groupKey = newGroupKey();

    const envelope = courierEncryptGroupKey(joinerPub, groupKey, CTX);
    expect(() => joinerDecryptGroupKey(attackerPriv, joinerPub, envelope, CTX)).toThrow();
  });

  it('fails closed when the salt is tampered (substituted joiner pub)', () => {
    const joinerPriv = randomBytes(32);
    const joinerPub = x25519.getPublicKey(joinerPriv);
    const fakePub = x25519.getPublicKey(randomBytes(32));
    const groupKey = newGroupKey();

    const envelope = courierEncryptGroupKey(joinerPub, groupKey, CTX);
    // Joiner uses the WRONG public key as the salt input — HKDF derives a
    // different AEAD key and decryption must fail.
    expect(() => joinerDecryptGroupKey(joinerPriv, fakePub, envelope, CTX)).toThrow();
  });

  it.each([
    ['group', { groupId: '22222222-2222-4222-8222-222222222222' }],
    ['joiner', { joinerUserId: '33333333-3333-4333-8333-333333333333' }],
    ['joiner device', { joinerDeviceId: '44444444-4444-4444-8444-444444444444' }],
    ['key version', { keyVersion: 2 }],
  ])('fails closed when the envelope was made for another %s', (_label, change) => {
    const joinerPriv = randomBytes(32);
    const joinerPub = x25519.getPublicKey(joinerPriv);

    const envelope = courierEncryptGroupKey(joinerPub, newGroupKey(), CTX);
    expect(() => joinerDecryptGroupKey(joinerPriv, joinerPub, envelope, { ...CTX, ...change })).toThrow();
  });

  it('rejects mis-sized inputs', () => {
    expect(() => courierEncryptGroupKey(new Uint8Array(31), newGroupKey(), CTX)).toThrow(/32 bytes/);
    expect(() => courierEncryptGroupKey(new Uint8Array(32), new Uint8Array(31), CTX)).toThrow(/32 bytes/);
  });
});

describe('groupCrypto — attestation', () => {
  it('matches the server-side derivation (HMAC-SHA256(token, pubkey))', () => {
    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake.test-token';
    const pub = x25519.getPublicKey(randomBytes(32));

    const ours = computeAttestation(token, pub);
    // Recompute via Node stdlib (the path the server takes).
    const theirs = createHmac('sha256', Buffer.from(token, 'utf8')).update(pub).digest();

    expect(Buffer.from(ours)).toEqual(theirs);
  });

  it('changes when the public key changes', () => {
    const token = 'same-token';
    const pubA = x25519.getPublicKey(randomBytes(32));
    const pubB = x25519.getPublicKey(randomBytes(32));
    expect(computeAttestation(token, pubA)).not.toEqual(computeAttestation(token, pubB));
  });

  it('changes when the token changes', () => {
    const pub = x25519.getPublicKey(randomBytes(32));
    expect(computeAttestation('token-a', pub)).not.toEqual(computeAttestation('token-b', pub));
  });

  it('produces a 32-byte output', () => {
    const out = computeAttestation('t', x25519.getPublicKey(randomBytes(32)));
    expect(out.length).toBe(32);
  });
});

describe('groupCrypto — X25519 key derivation', () => {
  it('derives the same public key from the same seed', () => {
    const seed = randomBytes(32);
    expect(x25519.getPublicKey(seed)).toEqual(x25519.getPublicKey(seed));
  });

  it('derives different public keys from different seeds', () => {
    expect(x25519.getPublicKey(randomBytes(32))).not.toEqual(x25519.getPublicKey(randomBytes(32)));
  });

  it('ECDH is commutative (alice→bob === bob→alice)', () => {
    const a = randomBytes(32);
    const b = randomBytes(32);
    const aPub = x25519.getPublicKey(a);
    const bPub = x25519.getPublicKey(b);
    expect(x25519.getSharedSecret(a, bPub)).toEqual(x25519.getSharedSecret(b, aPub));
  });
});
