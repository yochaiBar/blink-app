import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { theme } from '@/constants/colors';

interface AiCommentaryCardProps {
  commentary: string;
}

/**
 * Displays AI-generated commentary about a completed challenge.
 * Styled as a speech-bubble card with a subtle gradient-like border,
 * animated in with a fade + slide up.
 */
export default function AiCommentaryCard({ commentary }: AiCommentaryCardProps) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 500,
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  return (
    <Animated.View
      style={[
        styles.container,
        {
          opacity: fadeAnim,
          transform: [{ translateY: slideAnim }],
        },
      ]}
    >
      {/* Speech bubble tail */}
      <View style={styles.tail} />

      <View style={styles.header}>
        <View style={styles.aiBadge}>
          <Text style={styles.aiBadgeText}>AI</Text>
        </View>
        <Text style={styles.label}>Blink AI</Text>
      </View>

      <Text style={styles.commentaryText}>
        {'\u2728'} {commentary}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.bgElevated,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: theme.purpleMuted,
    position: 'relative',
  },
  tail: {
    position: 'absolute',
    top: -6,
    left: 24,
    width: 12,
    height: 12,
    backgroundColor: theme.bgElevated,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderColor: theme.purpleMuted,
    transform: [{ rotate: '45deg' }],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  aiBadge: {
    backgroundColor: theme.purpleMuted,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  aiBadgeText: {
    fontSize: 11,
    fontWeight: '800' as const,
    color: theme.purple,
    letterSpacing: 0.5,
  },
  label: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: theme.textSecondary,
  },
  commentaryText: {
    fontSize: 15,
    fontStyle: 'italic',
    color: theme.text,
    lineHeight: 22,
  },
});
