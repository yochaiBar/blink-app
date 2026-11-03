import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useAuthStore } from '@/stores/authStore';
import { sweepExpiredSenderPlaintexts } from '@/services/photoStore';
import { retryPendingRelays } from '@/services/relayRetry';

/**
 * Whenever the app comes to the foreground (and once on sign-in): drop
 * sender photo copies past their 7 days, and send photos whose relay failed
 * earlier. Mount once, in the root layout.
 */
export function useForegroundMaintenance(): void {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (!isAuthenticated) return;
    const run = () => {
      sweepExpiredSenderPlaintexts().catch(() => undefined);
      retryPendingRelays().catch(() => undefined);
    };
    run();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') run();
    });
    return () => subscription.remove();
  }, [isAuthenticated]);
}
