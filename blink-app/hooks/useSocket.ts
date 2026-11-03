import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { connectSocket, disconnectSocket } from '@/services/socket';
import { deliverKeyshare, requestKeyshare } from '@/services/api';
import { playChallengeRing } from '@/utils/challengeSound';
import {
  bytesToB64,
  b64ToBytes,
  courierEncryptGroupKey,
  joinerDecryptGroupKey,
  loadGroupKey,
  loadGroupKeyVersion,
  storeGroupKey,
  getOrCreateDeviceKey,
} from '@/services/groupCrypto';
import { receivePhoto, respondToPickup } from '@/services/photoTransfer';
import type {
  IncomingPhotoEnvelope,
  KeyshareEnvelope,
  KeyshareRequest,
  PhotoPickupRequest,
} from '@/shared/photoProtocol';

/** The signed-in user's id, read at event time (listeners outlive renders). */
function currentUserId(): string | undefined {
  return useAuthStore.getState().user?.id;
}

interface ChallengeStartedPayload {
  id: string;
  group_id: string;
  created_by?: string;
}

interface ChallengeResponsePayload {
  challengeId: string;
  groupId?: string;
  response: { id: string; challenge_id: string; user_id: string };
}

interface ChallengeCompletedPayload {
  challengeId: string;
  groupId: string;
}

interface MemberJoinedPayload {
  groupId: string;
  userId: string;
  displayName: string;
}

interface CommentEventPayload {
  response_id: string;
  comment?: unknown;
  comment_id?: string;
}

/**
 * Manages the Socket.io connection lifecycle and wires real-time events
 * to React Query cache invalidation. Group rooms are joined by the server
 * (on connect and on create / join / leave), not by the client.
 *
 * Call this once inside the root layout (inside QueryClientProvider and
 * after auth state is available).
 */
export function useSocket() {
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const listenersAttached = useRef(false);

  // Connect / disconnect based on auth state
  useEffect(() => {
    if (!isAuthenticated) {
      disconnectSocket();
      listenersAttached.current = false;
      return;
    }

    const socket = connectSocket();
    if (!socket) return;

    // Attach event listeners only once per socket instance
    if (!listenersAttached.current) {
      listenersAttached.current = true;

      socket.on('challenge:started', (data: ChallengeStartedPayload) => {
        if (__DEV__) console.log('[Socket] challenge:started', data);
        const groupId = data.group_id;
        queryClient.invalidateQueries({ queryKey: ['challenge', groupId] });
        queryClient.invalidateQueries({ queryKey: ['groups'] });

        // Play distinctive alert sound + haptics for group members (skip for originator)
        if (data.created_by !== currentUserId()) {
          playChallengeRing().catch(() => {});
        }
      });

      socket.on('challenge:response', (data: ChallengeResponsePayload) => {
        if (__DEV__) console.log('[Socket] challenge:response', data);
        queryClient.invalidateQueries({ queryKey: ['responses', data.challengeId] });
        queryClient.invalidateQueries({ queryKey: ['groups'] });
        queryClient.invalidateQueries({ queryKey: ['challenge-reveal', data.challengeId] });
        queryClient.invalidateQueries({ queryKey: ['feed-active-challenges'] });
        queryClient.invalidateQueries({ queryKey: ['blinks-feed-v2'] });
        if (data.groupId) {
          queryClient.invalidateQueries({ queryKey: ['challenge', data.groupId] });
        }
      });

      socket.on('challenge:completed', (data: ChallengeCompletedPayload) => {
        if (__DEV__) console.log('[Socket] challenge:completed', data);
        queryClient.invalidateQueries({ queryKey: ['challenge', data.groupId] });
        queryClient.invalidateQueries({ queryKey: ['responses', data.challengeId] });
        queryClient.invalidateQueries({ queryKey: ['groups'] });
      });

      socket.on('group:member-joined', (data: MemberJoinedPayload) => {
        if (__DEV__) console.log('[Socket] group:member-joined', data);
        queryClient.invalidateQueries({ queryKey: ['groups'] });
      });

      socket.on('comment:created', (data: CommentEventPayload) => {
        if (__DEV__) console.log('[Socket] comment:created', data);
        queryClient.invalidateQueries({ queryKey: ['comments', data.response_id] });
      });

      socket.on('comment:deleted', (data: CommentEventPayload) => {
        if (__DEV__) console.log('[Socket] comment:deleted', data);
        queryClient.invalidateQueries({ queryKey: ['comments', data.response_id] });
      });

      // ── E2E photo flow ───────────────────────────────────────
      // The handshake carries our device_id (services/socket.ts), so the
      // server can target pickup_request to the device holding the plaintext.

      // Incoming photo from a group member: decrypt, store, ACK.
      // Server side uses emitWithAck so the third arg is the ACK callback —
      // we call it with {ok: true} or {ok: false, error}.
      socket.on(
        'photo:incoming',
        async (payload: IncomingPhotoEnvelope, ack: (response: { ok: boolean; error?: string }) => void) => {
          if (__DEV__) console.log('[Socket] photo:incoming', payload.response_id);
          try {
            const result = await receivePhoto(payload);
            ack(result);
            if (result.ok) {
              // Invalidate any query that may show this photo so the
              // FeedItem / reveal screen re-reads from the local sandbox.
              queryClient.invalidateQueries({ queryKey: ['responses', payload.challenge_id] });
              queryClient.invalidateQueries({ queryKey: ['blinks-feed-v2'] });
              // FeedItem's local-photo query (Phase 5) — swap from
              // pending skeleton to the freshly-decrypted file URI.
              queryClient.invalidateQueries({ queryKey: ['localPhoto', payload.response_id] });
            }
          } catch (err) {
            if (__DEV__) console.warn('[Socket] photo:incoming handler threw', err);
            ack({ ok: false, error: 'BAD_PAYLOAD' });
          }
        },
      );

      // Server asks us (sender) to re-encrypt for a now-online recipient.
      // Re-encrypt from our local plaintext cache and POST to /relay.
      // If our cache has expired (TTL > 7d), respondToPickup returns null;
      // the server offers the pickup again later and reaps it after 7 days.
      socket.on('photo:pickup_request', async (payload: PhotoPickupRequest) => {
        if (__DEV__) console.log('[Socket] photo:pickup_request', payload);
        const senderUserId = currentUserId();
        if (!senderUserId) return;
        try {
          await respondToPickup(payload, senderUserId);
        } catch (err) {
          if (__DEV__) console.warn('[Socket] pickup respond failed', err);
        }
      });

      // ── Group-key courier handshake (Phase 4) ───────────────
      // Courier path: server asks us to share the group key with a joiner.
      // Look up our local group key, encrypt to the joiner's public key,
      // POST the opaque envelope to /api/keyshare/deliver. Server can't
      // decrypt — it just routes to the joiner's device room.
      socket.on('group:keyshare_request', async (payload: KeyshareRequest) => {
        if (__DEV__) console.log('[Socket] group:keyshare_request', payload);
        try {
          const groupKey = await loadGroupKey(payload.group_id);
          if (!groupKey) {
            // We're a member but somehow have no group key — race with our
            // own join? Best-effort: ignore. Another courier (or our own
            // device on next launch) will pick this up.
            if (__DEV__) {
              console.warn('[Socket] keyshare_request but no local group key');
            }
            return;
          }
          // Send the key's ACTUAL version so the joiner can resolve rotations
          // (higher version wins). Hardcoding 1 here would make every
          // regenerated key look stale to a recipient holding version 1.
          const storedVersion = await loadGroupKeyVersion(payload.group_id);
          const groupKeyVersion = storedVersion > 0 ? storedVersion : 1;
          const joinerPub = b64ToBytes(payload.joiner_x25519_public_key_b64);
          const envelope = courierEncryptGroupKey(joinerPub, groupKey, {
            groupId: payload.group_id,
            joinerUserId: payload.joiner_user_id,
            joinerDeviceId: payload.joiner_device_id,
            keyVersion: groupKeyVersion,
          });
          const { device_id: fromDeviceId } = await getOrCreateDeviceKey();
          await deliverKeyshare({
            v: 1,
            pending_join_id: payload.pending_join_id,
            group_id: payload.group_id,
            from_user_id: currentUserId() ?? '',
            from_device_id: fromDeviceId,
            ephemeral_public_key_b64: bytesToB64(envelope.ephemeralPublicKey),
            iv_b64: bytesToB64(envelope.iv),
            auth_tag_b64: bytesToB64(envelope.ciphertext.slice(envelope.ciphertext.length - 16)),
            ciphertext_b64: bytesToB64(envelope.ciphertext),
            group_key_version: groupKeyVersion,
          });
        } catch (err) {
          if (__DEV__) console.warn('[Socket] keyshare_request failed', err);
        }
      });

      // Joiner path: server delivered the encrypted group-key envelope.
      // ECDH + decrypt with our static device key, store the group key
      // locally. Idempotent: if we already have the key, validate the new
      // one matches; otherwise newest wins per the key_version field on
      // the envelope (Phase 5+ will surface UX when these differ).
      socket.on('group:keyshare_envelope', async (envelope: KeyshareEnvelope) => {
        if (__DEV__) console.log('[Socket] group:keyshare_envelope', envelope.group_id);
        const selfUserId = currentUserId();
        if (!selfUserId) return;
        try {
          const device = await getOrCreateDeviceKey();
          const ephemeral = b64ToBytes(envelope.ephemeral_public_key_b64);
          const iv = b64ToBytes(envelope.iv_b64);
          const ciphertext = b64ToBytes(envelope.ciphertext_b64);
          const incomingVersion = envelope.group_key_version ?? 1;
          // Our own view of the context: an envelope made for another group,
          // device or version fails to decrypt.
          const groupKey = joinerDecryptGroupKey(
            device.privateScalar,
            device.publicKey,
            { ephemeralPublicKey: ephemeral, iv, ciphertext },
            {
              groupId: envelope.group_id,
              joinerUserId: selfUserId,
              joinerDeviceId: device.device_id,
              keyVersion: incomingVersion,
            },
          );
          const existing = await loadGroupKey(envelope.group_id);
          if (existing) {
            const same = existing.length === groupKey.length && existing.every((b, i) => b === groupKey[i]);
            if (same) {
              // Idempotent duplicate — just make sure we've recorded the
              // (possibly newer) version number and move on.
              await storeGroupKey(envelope.group_id, groupKey, incomingVersion);
              return;
            }
            // Different key. This is a rotation (admin regenerated) iff the
            // incoming version is strictly higher — then it MUST win or the
            // group would split-brain. A same-or-lower version with
            // different bytes is a conflict we refuse (would silently brick
            // photos encrypted under our current key).
            const existingVersion = await loadGroupKeyVersion(envelope.group_id);
            if (incomingVersion <= existingVersion) {
              if (__DEV__) {
                console.warn('[Socket] keyshare_envelope conflicts with existing key at same/older version; ignored');
              }
              return;
            }
            if (__DEV__) {
              console.log(
                '[Socket] keyshare_envelope rotates group key',
                envelope.group_id,
                `v${existingVersion}→v${incomingVersion}`,
              );
            }
          }
          await storeGroupKey(envelope.group_id, groupKey, incomingVersion);
          queryClient.invalidateQueries({ queryKey: ['groups'] });
        } catch (err) {
          if (__DEV__) console.warn('[Socket] keyshare_envelope decrypt failed', err);
        }
      });

      // Loser of the courier race — server picked someone else. No-op.
      socket.on('group:keyshare_cancelled', () => {
        if (__DEV__) console.log('[Socket] group:keyshare_cancelled (no-op)');
      });

      // An admin regenerated the group key. If ours is older (or missing),
      // pull the new one via the recovery handshake. The admin's device
      // (which just minted the key) will courier it back and our
      // keyshare_envelope handler overwrites on higher version.
      socket.on('group:key_rotated', async (payload: { group_id: string; group_key_version: number }) => {
        if (__DEV__) console.log('[Socket] group:key_rotated', payload);
        try {
          const localVersion = await loadGroupKeyVersion(payload.group_id);
          if (payload.group_key_version > localVersion) {
            const { device_id } = await getOrCreateDeviceKey();
            await requestKeyshare({ group_id: payload.group_id, device_id });
          }
        } catch (err) {
          if (__DEV__) console.warn('[Socket] key_rotated handling failed', err);
        }
      });
    }

    return () => {
      // On cleanup (logout, unmount) tear down everything
      disconnectSocket();
      listenersAttached.current = false;
    };
  }, [isAuthenticated]);
}
