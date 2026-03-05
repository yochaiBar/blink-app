import React, { useState, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated, Platform } from 'react-native';
import { theme } from '@/constants/colors';
import { AiPersonality } from '@/types';

interface AiPersonalityPillProps {
  personality: AiPersonality;
}

const PERSONALITY_CONFIG: Record<AiPersonality, { emoji: string; description: string }> = {
  family_friendly: { emoji: '\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67\u200d\ud83d\udc66', description: 'challenges will have a family-friendly tone' },
  funny: { emoji: '\ud83d\ude02', description: 'challenges will have a funny tone' },
  spicy: { emoji: '\ud83c\udf36\ufe0f', description: 'challenges will have a spicy tone' },
  sarcastic: { emoji: '\ud83d\ude0f', description: 'challenges will have a sarcastic tone' },
  motivational: { emoji: '\ud83d\udcaa', description: 'challenges will have a motivational tone' },
  extreme: { emoji: '\ud83e\udd2f', description: 'challenges will have an extreme tone' },
  sexy: { emoji: '\ud83d\udc8b', description: 'challenges will have a sexy tone' },
  no_filter: { emoji: '\ud83d\udd25', description: 'challenges will have no filter' },
};

/**
 * A small pill badge that shows the group's AI personality setting.
 * Tapping it shows a brief tooltip with the description.
 */
export default function AiPersonalityPill({ personality }: AiPersonalityPillProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const tooltipAnim = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const config = PERSONALITY_CONFIG[personality];
  if (!config) return null;

  const displayName = personality.replace(/_/g, ' ');

  const handlePress = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);

    if (showTooltip) {
      Animated.timing(tooltipAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start(() => setShowTooltip(false));
    } else {
      setShowTooltip(true);
      Animated.timing(tooltipAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }).start();

      hideTimer.current = setTimeout(() => {
        Animated.timing(tooltipAnim, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }).start(() => setShowTooltip(false));
      }, 3000);
    }
  }, [showTooltip, tooltipAnim]);

  return (
    <View style={styles.wrapper}>
      <TouchableOpacity style={styles.pill} onPress={handlePress} activeOpacity={0.7}>
        <Text style={styles.emoji}>{config.emoji}</Text>
        <Text style={styles.name}>{displayName}</Text>
      </TouchableOpacity>

      {showTooltip && (
        <Animated.View
          style={[
            styles.tooltip,
            {
              opacity: tooltipAnim,
              transform: [
                {
                  translateY: tooltipAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [4, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <Text style={styles.tooltipText}>
            AI personality: {displayName.charAt(0).toUpperCase() + displayName.slice(1)} — {config.description}
          </Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
    zIndex: 10,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: theme.bgCard,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.border,
  },
  emoji: {
    fontSize: 14,
  },
  name: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: theme.textSecondary,
  },
  tooltip: {
    position: 'absolute',
    top: '100%',
    left: 0,
    marginTop: 6,
    backgroundColor: theme.bgElevated,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: theme.border,
    minWidth: 220,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
      },
      android: {
        elevation: 6,
      },
    }),
  },
  tooltipText: {
    fontSize: 12,
    color: theme.text,
    lineHeight: 17,
  },
});
