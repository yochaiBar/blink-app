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
    const blob = aesGcmEncrypt(key, plaintext);
    const recovered = aesGcmDecrypt(key, blob);
    expect(new TextDecoder().decode(recovered)).toBe('hello world');
  });

  it('generates a fresh random IV every call (H2 guard)', () => {
    const key = newGroupKey();
    const plaintext = new TextEncoder().encode('same input every time');
    const a = aesGcmEncrypt(key, plaintext);
    const b = aesGcmEncrypt(key, plaintext);
    // The whole point: two encrypts of the same plaintext under the same key
    // must produce different IVs and therefore different ciphertexts.
    expect(a.iv).not.toEqual(b.iv);
    expect(a.ciphertext).not.toEqual(b.ciphertext);
  });

  it('uses a 12-byte IV', () => {
    const key = newGroupKey();
    const blob = aesGcmEncrypt(key, new Uint8Array([1, 2, 3]));
    expect(blob.iv.length).toBe(12);
  });

  it('ciphertext is plaintext.length + 16-byte tag', () => {
    const key = newGroupKey();
    const plaintext = new Uint8Array(100);
    const blob = aesGcmEncrypt(key, plaintext);
    expect(blob.ciphertext.length).toBe(100 + 16);
  });

  it('fails closed on auth-tag failure (tampered ciphertext)', () => {
    const key = newGroupKey();
    const plaintext = new TextEncoder().encode('do not tamper');
    const blob = aesGcmEncrypt(key, plaintext);
    // Flip a bit in the ciphertext body.
    blob.ciphertext[0] ^= 0x01;
    expect(() => aesGcmDecrypt(key, blob)).toThrow();
  });

  it('fails closed when decrypting with the wrong key', () => {
    const keyA = newGroupKey();
    const keyB = newGroupKey();
    const blob = aesGcmEncrypt(keyA, new TextEncoder().encode('secret'));
    expect(() => aesGcmDecrypt(keyB, blob)).toThrow();
  });

  it('rejects keys of the wrong length', () => {
    const shortKey = new Uint8Array(16);
    expect(() => aesGcmEncrypt(shortKey, new Uint8Array([1]))).toThrow(/32 bytes/);
    expect(() =>
      aesGcmDecrypt(shortKey, { iv: new Uint8Array(12), ciphertext: new Uint8Array(17) }),
    ).toThrow(/32 bytes/);
  });

  it('rejects ciphertext shorter than the GCM tag', () => {
    const key = newGroupKey();
    expect(() =>
      aesGcmDecrypt(key, { iv: new Uint8Array(12), ciphertext: new Uint8Array(8) }),
    ).toThrow(/GCM tag/);
  });
});

describe('groupCrypto — courier handshake', () => {
  it('round-trips a group key from courier to joiner', () => {
    const joinerPriv = randomBytes(32);
    const joinerPub = x25519.getPublicKey(joinerPriv);
    const groupKey = newGroupKey();

    const envelope = courierEncryptGroupKey(joinerPub, groupKey);
    const recovered = joinerDecryptGroupKey(joinerPriv, joinerPub, envelope);

    expect(recovered).toEqual(groupKey);
  });

  it('produces a fresh ephemeral keypair on every handshake', () => {
    const joinerPriv = randomBytes(32);
    const joinerPub = x25519.getPublicKey(joinerPriv);
    const groupKey = newGroupKey();

    const a = courierEncryptGroupKey(joinerPub, groupKey);
    const b = courierEncryptGroupKey(joinerPub, groupKey);
    expect(a.ephemeralPublicKey).not.toEqual(b.ephemeralPublicKey);
    expect(a.iv).not.toEqual(b.iv);
    expect(a.ciphertext).not.toEqual(b.ciphertext);
  });

  it("fails closed when the joiner's static private key is wrong", () => {
    const joinerPriv = randomBytes(32);
    const joinerPub = x25519.getPublicKey(joinerPriv);
    const attackerPriv = randomBytes(32);
    const groupKey = newGroupKey();

    const envelope = courierEncryptGroupKey(joinerPub, groupKey);
    expect(() =>
      joinerDecryptGroupKey(attackerPriv, joinerPub, envelope),
    ).toThrow();
  });

  it('fails closed when the salt is tampered (substituted joiner pub)', () => {
    const joinerPriv = randomBytes(32);
    const joinerPub = x25519.getPublicKey(joinerPriv);
    const fakePub = x25519.getPublicKey(randomBytes(32));
    const groupKey = newGroupKey();

    const envelope = courierEncryptGroupKey(joinerPub, groupKey);
    // Joiner uses the WRONG public key as the salt input — HKDF derives a
    // different AEAD key and decryption must fail.
    expect(() =>
      joinerDecryptGroupKey(joinerPriv, fakePub, envelope),
    ).toThrow();
  });

  it('rejects mis-sized inputs', () => {
    expect(() =>
      courierEncryptGroupKey(new Uint8Array(31), newGroupKey()),
    ).toThrow(/32 bytes/);
    expect(() =>
      courierEncryptGroupKey(new Uint8Array(32), new Uint8Array(31)),
    ).toThrow(/32 bytes/);
  });
});

describe('groupCrypto — attestation', () => {
  it('matches the server-side derivation (HMAC-SHA256(token, pubkey))', () => {
    const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake.test-token';
    const pub = x25519.getPublicKey(randomBytes(32));

    const ours = computeAttestation(token, pub);
    // Recompute via Node stdlib (the path the server takes).
    const theirs = createHmac('sha256', Buffer.from(token, 'utf8'))
      .update(pub)
      .digest();

    expect(Buffer.from(ours)).toEqual(theirs);
  });

  it('changes when the public key changes', () => {
    const token = 'same-token';
    const pubA = x25519.getPublicKey(randomBytes(32));
    const pubB = x25519.getPublicKey(randomBytes(32));
    expect(computeAttestation(token, pubA)).not.toEqual(
      computeAttestation(token, pubB),
    );
  });

  it('changes when the token changes', () => {
    const pub = x25519.getPublicKey(randomBytes(32));
    expect(computeAttestation('token-a', pub)).not.toEqual(
      computeAttestation('token-b', pub),
    );
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
    expect(x25519.getPublicKey(randomBytes(32))).not.toEqual(
      x25519.getPublicKey(randomBytes(32)),
    );
  });

  it('ECDH is commutative (alice→bob === bob→alice)', () => {
    const a = randomBytes(32);
    const b = randomBytes(32);
    const aPub = x25519.getPublicKey(a);
    const bPub = x25519.getPublicKey(b);
    expect(x25519.getSharedSecret(a, bPub)).toEqual(
      x25519.getSharedSecret(b, aPub),
    );
  });
});
