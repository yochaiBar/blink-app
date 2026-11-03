import { useCallback, useEffect, useMemo } from 'react';
import { Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Group } from '@/types';
import { api, confirmGroupKey, requestKeyshare } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { apiGroupListToGroup } from '@/utils/adapters';
import { ApiGroupListItem } from '@/types/api';
import { demoSource } from '@/services/demoSource';
import { getOrCreateDeviceKey, loadGroupKey, loadGroupKeyVersion } from '@/services/groupCrypto';
import { mintGroupKey } from '@/services/keyTransfer';
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

  const realGroups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data]);
  const querySettled = groupsQuery.isFetched || groupsQuery.isError;
  const shouldShowDemoGroup = querySettled && realGroups.length === 0 && !tourComplete;

  // ── Group-key bootstrap + recovery (E2E photo flow) ─────────────
  // On launch we reconcile every group's local key against reality:
  //
  //   • Solo group, no key → mint locally (no one to diverge from) and
  //     confirm it.
  //   • Multi-member group, no key → REQUEST recovery, so a holder of the
  //     current key re-couriers it (stalled join, reinstall).
  //   • Key present but STALE (local version < server version) → an admin
  //     reset the key; pull the new one via recovery too.
  //   • Key present at the server's version → (re-)confirm it, so the
  //     server knows we can courier it. Idempotent.
  useEffect(() => {
    if (!querySettled) return;
    void (async () => {
      let deviceId: string | null = null;
      const ensureDeviceId = async () => {
        if (!deviceId) deviceId = (await getOrCreateDeviceKey()).device_id;
        return deviceId;
      };
      for (const g of realGroups) {
        // memberCount may not be populated by every adapter call;
        // fall back to members.length.
        const count = g.memberCount ?? g.members?.length ?? 0;
        const serverVersion = g.groupKeyVersion ?? 1;
        const existing = await loadGroupKey(g.id);

        if (!existing) {
          if (count <= 1) {
            // Solo — safe to mint locally at the server's version.
            try {
              await mintGroupKey(g.id, serverVersion);
              if (__DEV__) console.log('[useGroups] auto-generated key for solo group', g.id);
            } catch (err) {
              if (__DEV__) console.warn('[useGroups] solo key mint failed', g.id, err);
            }
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
        if (serverVersion === localVersion) {
          confirmGroupKey({ group_id: g.id, key_version: localVersion }).catch(() => undefined);
        } else if (serverVersion > localVersion) {
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

  // Until the user has a real group (and hasn't finished the tour), the list
  // shows the demo group from demoSource.
  const groups = useMemo(
    () => (shouldShowDemoGroup ? [demoSource.listItem()] : realGroups),
    [realGroups, shouldShowDemoGroup],
  );

  // ── Create group ──
  const groupMutation = useMutation({
    mutationFn: async (group: Group) => {
      const result = await api<{ id: string; group_key_version?: number }>('/groups', {
        method: 'POST',
        body: JSON.stringify({ name: group.name, icon: group.emoji }),
      });
      // Group creator becomes the source of truth for the group key. No
      // handshake needed — we ARE the only member. Confirming it lets us
      // courier it to later joiners.
      try {
        await mintGroupKey(result.id, result.group_key_version ?? 1);
      } catch (err) {
        // Non-blocking: the group exists. The launch-time reconcile above
        // mints (solo) or re-confirms the key on the next pass.
        if (__DEV__) console.warn('[useGroups] group key setup failed', err);
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
    /** Groups from the server only (never the demo group): use for anything that calls the API per group. */
    serverGroups: realGroups,
    shouldShowDemoGroup,
    /** Id of the demo group while it is shown, else null. */
    demoGroupId: shouldShowDemoGroup ? demoSource.groupId : null,
    isLoadingGroups: groupsQuery.isLoading && isAuthenticated,
    isDataLoaded: !groupsQuery.isLoading,
    isRefreshing: groupsQuery.isRefetching,
    createGroup,
    joinGroup,
    refreshGroups,
  };
}
