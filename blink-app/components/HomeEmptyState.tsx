import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Zap } from 'lucide-react-native';
import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { spacing, borderRadius } from '@/constants/spacing';
import type { HomeEmptyState as HomeEmptyStateKind } from '@/services/homeView';

interface Props {
  kind: HomeEmptyStateKind;
  /** Shown for a new user while the demo group is listed: hides it for good. */
  onHideDemo?: () => void;
}

const tap = () => {
  if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
};

/** Below Home's cards: how to get started (new user), or why nothing shows yet. */
export default function HomeEmptyState({ kind, onHideDemo }: Props) {
  const router = useRouter();

  if (kind === 'no_challenges') {
    return (
      <View style={styles.container}>
        <View style={styles.icon}>
          <Zap size={48} color={theme.coral} fill={theme.coral} />
        </View>
        <Text style={styles.title}>No challenges yet</Text>
        <Text style={styles.subtitle}>When your groups run challenges, they show up here.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="home-empty-new-user">
      <Text style={styles.title}>Start your crew</Text>
      <Text style={styles.subtitle}>
        Blinks happen in groups. Create one for your people, or join one with an invite code.
      </Text>
      <TouchableOpacity
        style={styles.primary}
        onPress={() => {
          tap();
          router.push('/create-group');
        }}
        testID="home-create-group"
      >
        <LinearGradient
          colors={[theme.coral, theme.coralDark]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.primaryGradient}
        >
          <Text style={styles.primaryText}>Create a group</Text>
        </LinearGradient>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.secondary}
        onPress={() => {
          tap();
          router.push('/join-group');
        }}
        testID="home-join-group"
      >
        <Text style={styles.secondaryText}>Join with a code</Text>
      </TouchableOpacity>
      {onHideDemo ? (
        <TouchableOpacity onPress={onHideDemo} style={styles.hideDemo} testID="home-hide-demo">
          <Text style={styles.hideDemoText}>Hide the demo group</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingTop: spacing.xxl, paddingHorizontal: spacing.xl },
  icon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: theme.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  title: { ...typography.headlineLarge, color: theme.text, marginBottom: spacing.sm },
  subtitle: {
    ...typography.bodyMedium,
    color: theme.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: spacing.xl,
    maxWidth: 300,
  },
  primary: { borderRadius: borderRadius.full, overflow: 'hidden', alignSelf: 'stretch' },
  primaryGradient: { paddingVertical: spacing.md, borderRadius: borderRadius.full, alignItems: 'center' },
  primaryText: { ...typography.labelLarge, color: theme.white, fontWeight: '700' },
  secondary: {
    marginTop: spacing.md,
    alignSelf: 'stretch',
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: theme.border,
  },
  secondaryText: { ...typography.labelLarge, color: theme.text, fontWeight: '700' },
  hideDemo: { marginTop: spacing.lg, padding: spacing.sm },
  hideDemoText: { ...typography.caption, color: theme.textMuted },
});
