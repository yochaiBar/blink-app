import { useEffect, useRef } from 'react';
import {
  bytesToB64,
  computeAttestation,
  getOrCreateDeviceKey,
} from '@/services/groupCrypto';
import { getAccessToken, registerDeviceKey } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';

/**
 * Registers (or rotates) this device's X25519 public key with the server
 * the first time the user becomes authenticated in any session. Runs once
 * per app launch — idempotent on the server (the route upserts).
 *
 * Why it lives in a hook: it needs the JWT access token (for the
 * attestation HMAC) and the auth-state from the store, both of which are
 * React-shaped. The crypto itself is framework-free in `services/groupCrypto`.
 *
 * Failure mode: silent retry on next launch. We deliberately do NOT block
 * the app's load on this — the photo flow that needs the public key is a
 * Phase 3+ feature; users without a registered key still get the existing
 * (legacy) photo path until the feature flag flips.
 */
export function useDeviceKeyRegistration() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const userId = useAuthStore((s) => s.user?.id);
  const attempted = useRef<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !userId) return;
    // Avoid re-firing for the same logged-in user within the same session.
    if (attempted.current === userId) return;
    attempted.current = userId;

    (async () => {
      try {
        const token = getAccessToken();
        if (!token) return; // shouldn't happen if isAuthenticated, but defensive

        const { device_id, publicKey } = await getOrCreateDeviceKey();
        const attestation = computeAttestation(token, publicKey);
        await registerDeviceKey({
          v: 1,
          device_id,
          x25519_public_key_b64: bytesToB64(publicKey),
          attestation_b64: bytesToB64(attestation),
        });
      } catch (err) {
        // Non-blocking. The retry surface is "next app launch."
        if (__DEV__) {
          console.warn('[deviceKey] registration failed', err);
        }
        attempted.current = null;
      }
    })();
  }, [isAuthenticated, userId]);
}
