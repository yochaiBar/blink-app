import { useCallback, useMemo } from 'react';
import { Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Group } from '@/types';
import { api } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import { useOnboardingStore } from '@/stores/onboardingStore';
import { apiGroupListToGroup } from '@/utils/adapters';
import { ApiGroupListItem } from '@/types/api';
import { demoSource } from '@/services/demoSource';
import { getOrCreateDeviceKey } from '@/services/groupCrypto';
import { mintGroupKey } from '@/services/keyTransfer';
import { queryKeys } from '@/utils/queryKeys';

/** GET /groups as app Groups (shared by every query on queryKeys.groups.all). */
export async function fetchGroups(): Promise<Group[]> {
  const data: ApiGroupListItem[] = await api('/groups');
  return data.map(apiGroupListToGroup);
}

export function useGroups() {
  const queryClient = useQueryClient();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const tourComplete = useOnboardingStore((s) => s.tourComplete);
  const completeTourAction = useOnboardingStore((s) => s.completeTour);

  // ── Groups list ──
  const groupsQuery = useQuery({
    queryKey: queryKeys.groups.all,
    queryFn: fetchGroups,
    enabled: isAuthenticated,
    staleTime: 30_000,
  });

  const realGroups = useMemo(() => groupsQuery.data ?? [], [groupsQuery.data]);
  const querySettled = groupsQuery.isFetched || groupsQuery.isError;
  const shouldShowDemoGroup = querySettled && realGroups.length === 0 && !tourComplete;

  // Group keys are reconciled once, app-wide, by useGroupKeySync.

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
        // Non-blocking: the group exists. useGroupKeySync mints (solo) or
        // re-confirms the key on its next pass.
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
