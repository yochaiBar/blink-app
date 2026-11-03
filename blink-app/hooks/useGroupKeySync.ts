import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/authStore';
import { fetchGroups } from '@/hooks/useGroups';
import { resetGroupKeySync, syncGroupKeys } from '@/services/groupKeySync';
import { queryKeys } from '@/utils/queryKeys';

/**
 * Keep every group's key in step with the server (services/groupKeySync)
 * whenever the groups list loads or changes. Mount once, in the root layout.
 */
export function useGroupKeySync(): void {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { data: groups } = useQuery({
    queryKey: queryKeys.groups.all,
    queryFn: fetchGroups,
    enabled: isAuthenticated,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!isAuthenticated) {
      resetGroupKeySync();
      return;
    }
    if (groups) syncGroupKeys(groups).catch(() => undefined);
  }, [isAuthenticated, groups]);
}
