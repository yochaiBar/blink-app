import { useCallback } from 'react';
import { Alert } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  readAsStringAsync,
  EncodingType,
} from 'expo-file-system/legacy';
import { api, uploadPhoto, uploadPhotoEncrypted } from '@/services/api';
import { isDemoGroup } from '@/constants/demoData';
import { ApiChallenge } from '@/types/api';
import { queryKeys } from '@/utils/queryKeys';
import { useAuthStore } from '@/stores/authStore';
import { b64ToBytes } from '@/services/groupCrypto';
import { sendPhoto } from '@/services/photoTransfer';
import { putReceivedPhoto } from '@/services/photoStore';

/**
 * Submit a snap response to the active challenge in `groupId`.
 *
 * Two photo flows live here side-by-side during the v1→v2 migration:
 *
 *   v1 (legacy): upload encrypted bytes to S3 via /upload/encrypted,
 *   then POST /respond with the resulting photo_url. Server holds the
 *   ciphertext on disk; server-held master key wraps the per-group key.
 *
 *   v2 (no-server-storage): POST /respond with { has_photo: true } first
 *   to get a response_id, then peer-to-peer encrypt+relay the bytes via
 *   /api/photos/relay using the group key that lives only on member
 *   devices. Server never sees plaintext OR group-key material.
 *
 * Branch is controlled by `feature_flags.photo_v2` returned from /auth/me.
 * Defaults to v1 if the flag is missing (e.g. older server).
 */
export function useSubmitSnap() {
  const queryClient = useQueryClient();
  const photoV2 = useAuthStore((s) => s.featureFlags.photo_v2);
  const selfUserId = useAuthStore((s) => s.user?.id);

  const snapMutation = useMutation({
    mutationFn: async ({ groupId, imageUri }: { groupId: string; imageUri?: string }) => {
      // Skip API calls for demo group
      if (isDemoGroup(groupId)) return;

      // Find active challenge for this group
      let challengeId: string | null = null;
      try {
        const challenge: ApiChallenge = await api(`/challenges/groups/${groupId}/challenges/active`);
        challengeId = challenge.id;
      } catch {
        // No active challenge found for this group -- not an error
      }

      if (!challengeId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.groups.all });
        return;
      }

      if (photoV2 && imageUri) {
        return submitV2({
          groupId,
          challengeId,
          imageUri,
          selfUserId,
        });
      }

      // ── v1 path (legacy) ──────────────────────────────────────
      const body: Record<string, unknown> = {};
      if (imageUri) {
        try {
          const encResult = await uploadPhotoEncrypted(imageUri, groupId, challengeId);
          body.photo_url = encResult.photo_url ?? imageUri;
          if (encResult.encryption_metadata) {
            body.encryption_metadata = encResult.encryption_metadata;
          }
        } catch {
          // Fall back to regular upload
          const photoUrl = await uploadPhoto(imageUri, groupId, challengeId);
          body.photo_url = photoUrl;
        }
      }
      body.response_time_ms = 5000;

      return api(`/challenges/${challengeId}/respond`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.groups.all });
      queryClient.invalidateQueries({ queryKey: ['responses'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.user.stats });
      // v2 path returned a response object with id — wake the sender's
      // own FeedItem so it picks up the just-cached local photo.
      const responseId =
        data && typeof data === 'object' && 'id' in data
          ? (data as { id: string }).id
          : null;
      if (responseId) {
        queryClient.invalidateQueries({ queryKey: ['localPhoto', responseId] });
      }
    },
    onError: (error: Error) => {
      Alert.alert('Snap Failed', error.message || 'Could not submit your snap. Please try again.');
    },
  });

  const submitSnap = useCallback(
    async (groupId: string, imageUri?: string) => {
      await snapMutation.mutateAsync({ groupId, imageUri });
    },
    [snapMutation],
  );

  return {
    submitSnap,
    isSubmitting: snapMutation.isPending,
  };
}

// ── v2 path ──────────────────────────────────────────────────────

interface V2Args {
  groupId: string;
  challengeId: string;
  imageUri: string;
  selfUserId: string | undefined;
}

interface MemberListResponse {
  members?: Array<{ user_id?: string; id?: string }>;
}

interface RespondResponse {
  id: string;
}

async function submitV2(args: V2Args): Promise<RespondResponse> {
  // 1. Read raw bytes from the camera output file.
  const b64 = await readAsStringAsync(args.imageUri, {
    encoding: EncodingType.Base64,
  });
  const plaintext = b64ToBytes(b64);

  // 2. POST /respond with has_photo: true. Bytes do NOT travel here.
  //    Returns the response object including its server-assigned id.
  const response = await api<RespondResponse>(
    `/challenges/${args.challengeId}/respond`,
    {
      method: 'POST',
      body: JSON.stringify({
        has_photo: true,
        response_time_ms: 5000,
      }),
    },
  );

  // 3. Fetch the current group members so we know who to encrypt for.
  //    Recipients = every member except us; the relay endpoint will also
  //    filter (defense in depth) but we should pass the right set up front.
  const groupDetail = await api<MemberListResponse>(`/groups/${args.groupId}`);
  const memberIds = (groupDetail.members ?? [])
    .map((m) => m.user_id ?? m.id)
    .filter((id): id is string => typeof id === 'string')
    .filter((id) => id !== args.selfUserId);

  // 4. Cache plaintext in OUR received store too — feed item renders the
  //    same path for sender + recipients (one less branch in FeedItem).
  //    Best-effort; failures don't block the relay.
  putReceivedPhoto(response.id, plaintext).catch(() => undefined);

  // 5. Encrypt + relay. sendPhoto also writes to the sender plaintext
  //    cache (for pickup-on-demand). If memberIds is empty (1-member
  //    group), skip — the response is recorded; no peers to relay to.
  if (memberIds.length > 0) {
    await sendPhoto({
      groupId: args.groupId,
      challengeId: args.challengeId,
      responseId: response.id,
      recipientUserIds: memberIds,
      plaintext,
    });
  }

  return response;
}
