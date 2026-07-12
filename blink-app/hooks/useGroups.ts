import { useCallback, useEffect, useMemo } from 'react';
import { Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Group } from '@/types';
import { api, requestKeyshare } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { apiGroupListToGroup } from '@/utils/adapters';
import { ApiGroupListItem } from '@/types/api';
import { DEMO_GROUP, isDemoGroup } from '@/constants/demoData';
import {
  getOrCreateDeviceKey,
  loadGroupKey,
  loadGroupKeyVersion,
  newGroupKey,
  storeGroupKey,
} from '@/services/groupCrypto';
import { queryKeys } from '@/utils/queryKeys';

export function useGroups() {
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const tourComplete = useOnboardingStore((s) => s.tourComplete);
  const completeTourAction = useOnboardingStore((s) => s.completeTour);

  // ── Groups list ──
  const groupsQuery = useQuery({
    queryKey: queryKeys.groups.all,
    queryFn: async (): Promise<Group[]> => {
      const data: ApiGroupListItem[] = await api('/groups');
      return data.map(apiGroupListToGroup);
    },
    enabled: isAuthenticated,
    staleTime: 30_000,
  });

  const realGroups = groupsQuery.data ?? [];
  const querySettled = groupsQuery.isFetched || groupsQuery.isError;
  const shouldShowDemoGroup = querySettled && realGroups.length === 0 && !tourComplete;

  // ── Group-key bootstrap + recovery (E2E photo flow) ─────────────
  // On launch we reconcile every group's local key against reality:
  //
  //   • Solo group, no key → generate locally (no one to diverge from).
  //   • Multi-member group, no key → REQUEST recovery. The original flow
  //     only couriered a key at join time, so a stalled join or a
  //     pre-migration group whose server key was dropped left the member
  //     permanently stuck on "no group key; handshake required". This asks
  //     online members to re-courier it.
  //   • Key present but STALE (local version < server version) → an admin
  //     regenerated the key; pull the new one via recovery too.
  useEffect(() => {
    if (!querySettled) return;
    void (async () => {
      let deviceId: string | null = null;
      const ensureDeviceId = async () => {
        if (!deviceId) deviceId = (await getOrCreateDeviceKey()).device_id;
        return deviceId;
      };
      for (const g of realGroups) {
        if (isDemoGroup(g.id)) continue;
        // memberCount may not be populated by every adapter call;
        // fall back to members.length.
        const count = g.memberCount ?? g.members?.length ?? 0;
        const serverVersion = g.groupKeyVersion ?? 1;
        const existing = await loadGroupKey(g.id);

        if (!existing) {
          if (count <= 1) {
            // Solo — safe to mint locally at the server's version.
            const key = newGroupKey();
            await storeGroupKey(g.id, key, serverVersion);
            if (__DEV__) console.log('[useGroups] auto-generated key for solo group', g.id);
          } else {
            // Multi-member and we have nothing — ask for a re-courier.
            try {
              await requestKeyshare({ group_id: g.id, device_id: await ensureDeviceId() });
              if (__DEV__) console.log('[useGroups] requested key recovery for group', g.id);
            } catch (err) {
              if (__DEV__) console.warn('[useGroups] key recovery request failed', g.id, err);
            }
          }
          continue;
        }

        // We hold a key — pull a newer one if the server's version moved
        // ahead of ours (admin reset).
        const localVersion = await loadGroupKeyVersion(g.id);
        if (serverVersion > localVersion) {
          try {
            await requestKeyshare({ group_id: g.id, device_id: await ensureDeviceId() });
            if (__DEV__) {
              console.log('[useGroups] requested rotated key for group', g.id, `v${localVersion}→v${serverVersion}`);
            }
          } catch (err) {
            if (__DEV__) console.warn('[useGroups] rotated key request failed', g.id, err);
          }
        }
      }
    })().catch(() => undefined);
  }, [querySettled, realGroups]);

  const groups = useMemo(() => {
    if (shouldShowDemoGroup) {
      return [{ ...DEMO_GROUP, challengeEndTime: Date.now() + 30 * 60 * 1000 }];
    }
    return realGroups;
  }, [realGroups, shouldShowDemoGroup]);

  // ── Create group ──
  const groupMutation = useMutation({
    mutationFn: async (group: Group) => {
      const result = await api<{ id: string }>('/groups', {
        method: 'POST',
        body: JSON.stringify({
          name: group.name,
          icon: group.emoji,
          category: group.category === 'close_friends' ? 'friends' : group.category,
          skip_penalty_type: 'none',
          ai_personality: group.aiPersonality ?? 'funny',
        }),
      });
      // Group creator becomes the source of truth for the group key. No
      // handshake needed — we ARE the only member. Subsequent joiners
      // receive the key via the courier flow from our device.
      try {
        const key = newGroupKey();
        await storeGroupKey(result.id, key);
      } catch (err) {
        // Non-blocking: the group exists; if local key storage failed,
        // photo sending will surface "no group key" until we successfully
        // re-store on next app launch (the key would be regenerated though
        // — Phase 5 wiring will need a retry-or-rotate UX). For v1 this
        // path is extremely unlikely (Keychain failure).
        if (__DEV__) console.warn('[useGroups] group key store failed', err);
      }
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.groups.all });
    },
    onError: (error: Error) => {
      Alert.alert('Create Group Failed', error.message || 'Could not create the group. Please try again.');
    },
  });

  const createGroup = useCallback(
    async (group: Group) => {
      await groupMutation.mutateAsync(group);
      completeTourAction();
    },
    [groupMutation, completeTourAction],
  );

  // ── Join group ──
  const joinGroup = useCallback(
    async (code: string): Promise<{ success: boolean; groupId?: string; groupName?: string; message: string }> => {
      try {
        // Include our device_id so the server can enqueue the courier
        // handshake routed back to this specific device. Old clients
        // omit it and the server skips the keyshare flow gracefully
        // (Phase 5 will flip the v2 photo path on when the key arrives).
        const { device_id } = await getOrCreateDeviceKey();
        const result = await api<{ id: string; name: string }>('/groups/join', {
          method: 'POST',
          body: JSON.stringify({ invite_code: code, device_id }),
        });
        queryClient.invalidateQueries({ queryKey: queryKeys.groups.all });
        completeTourAction();
        return { success: true, groupId: result.id, groupName: result.name, message: 'Joined successfully' };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to join group';
        Alert.alert('Join Failed', message);
        return { success: false, message };
      }
    },
    [queryClient, completeTourAction],
  );

  const refreshGroups = useCallback(() => {
    return groupsQuery.refetch();
  }, [groupsQuery]);

  return {
    groups,
    shouldShowDemoGroup,
    isLoadingGroups: groupsQuery.isLoading && isAuthenticated,
    isDataLoaded: !groupsQuery.isLoading,
    isRefreshing: groupsQuery.isRefetching,
    createGroup,
    joinGroup,
    refreshGroups,
    /** @internal used by useSubmitSnap to check demo group status */
    isDemoGroup,
  };
}
