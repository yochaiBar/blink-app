import React, { useEffect, useState } from 'react';
import { ActivityIndicator, AppState, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { WifiOff } from 'lucide-react-native';
import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { spacing, borderRadius } from '@/constants/spacing';

/** How often to try again on its own while the server can't be reached. */
const AUTO_RETRY_MS = 10_000;

interface Props {
  /** Try to confirm the stored session again (authStore.restoreSession). */
  onRetry: () => Promise<void>;
}

/**
 * Shown instead of onboarding when a session is stored but the server
 * couldn't confirm it (offline, restarting, 5xx). The user stays signed in;
 * this retries on its own, on foreground, and on tap.
 */
export default function OfflineScreen({ onRetry }: Props) {
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    let active = true;
    const retry = () => {
      if (!active) return;
      setRetrying(true);
      onRetry().finally(() => active && setRetrying(false));
    };
    const timer = setInterval(retry, AUTO_RETRY_MS);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') retry();
    });
    return () => {
      active = false;
      clearInterval(timer);
      subscription.remove();
    };
  }, [onRetry]);

  return (
    <View style={styles.container} testID="offline-screen">
      <WifiOff size={40} color={theme.textMuted} />
      <Text style={styles.title}>Can&apos;t reach Blinks</Text>
      <Text style={styles.subtitle}>You&apos;re still signed in. We&apos;ll keep trying, or you can try now.</Text>
      <TouchableOpacity
        style={styles.button}
        disabled={retrying}
        onPress={() => {
          setRetrying(true);
          onRetry().finally(() => setRetrying(false));
        }}
        testID="offline-retry"
      >
        {retrying ? <ActivityIndicator color={theme.white} /> : <Text style={styles.buttonText}>Try again</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
    backgroundColor: theme.bg,
  },
  title: { ...typography.headlineLarge, color: theme.text },
  subtitle: { ...typography.bodyMedium, color: theme.textSecondary, textAlign: 'center', maxWidth: 280 },
  button: {
    marginTop: spacing.md,
    minWidth: 160,
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: borderRadius.full,
    backgroundColor: theme.coral,
  },
  buttonText: { ...typography.labelLarge, color: theme.white, fontWeight: '700' },
});
