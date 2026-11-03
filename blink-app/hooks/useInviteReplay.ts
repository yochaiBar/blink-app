import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useAuthStore } from '@/stores/authStore';
import { usePendingInvite } from '@/stores/pendingInviteStore';

/**
 * Open a pending invite (app/+native-intent.tsx) on the join screen once
 * the user is signed in, named and out of onboarding — so a link tapped
 * before login is replayed after it. Mount once, in the root layout.
 */
export function useInviteReplay(inOnboarding: boolean): void {
  const router = useRouter();
  const isLoading = useAuthStore((s) => s.isLoading);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasName = useAuthStore((s) => !!s.user?.display_name);
  const pendingInvite = usePendingInvite((s) => s.code);

  useEffect(() => {
    if (isLoading || !isAuthenticated || !hasName || !pendingInvite || inOnboarding) return;
    usePendingInvite.getState().clear();
    router.push({ pathname: '/join-group', params: { code: pendingInvite } });
  }, [isLoading, isAuthenticated, hasName, pendingInvite, inOnboarding, router]);
}
