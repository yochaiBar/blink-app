import React, { useEffect, useRef } from 'react';
import { Animated, Text, StyleSheet, View } from 'react-native';

interface StreakIconProps {
  streak: number;
  size?: number;
}

export function getStreakEmoji(streak: number): string | null {
  if (streak >= 100) return '\u2B50';
  if (streak >= 30) return '\uD83D\uDC8E';
  if (streak >= 14) return '\uD83D\uDC51';
  if (streak >= 3) return '\uD83D\uDD25';
  return null;
}

export default function StreakIcon({ streak, size = 16 }: StreakIconProps) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const sparkleAnim = useRef(new Animated.Value(0)).current;

  const emoji = getStreakEmoji(streak);
  const hasFlameAnimation = streak >= 7 && streak < 14;
  const hasSparkleAnimation = streak >= 100;

  useEffect(() => {
    if (hasFlameAnimation) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.2,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
  }, [hasFlameAnimation, pulseAnim]);

  useEffect(() => {
    if (hasSparkleAnimation) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(sparkleAnim, {
            toValue: 1,
            duration: 1000,
            useNativeDriver: true,
          }),
          Animated.timing(sparkleAnim, {
            toValue: 0,
            duration: 1000,
            useNativeDriver: true,
          }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
  }, [hasSparkleAnimation, sparkleAnim]);

  if (!emoji) return null;

  if (hasFlameAnimation) {
    return (
      <Animated.Text style={[styles.icon, { fontSize: size, transform: [{ scale: pulseAnim }] }]}>
        {emoji}
      </Animated.Text>
    );
  }

  if (hasSparkleAnimation) {
    const sparkleOpacity = sparkleAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [0.6, 1],
    });
    const sparkleScale = sparkleAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 1.15],
    });
    return (
      <View style={styles.sparkleContainer}>
        <Animated.Text
          style={[
            styles.icon,
            {
              fontSize: size,
              opacity: sparkleOpacity,
              transform: [{ scale: sparkleScale }],
            },
          ]}
        >
          {emoji}
        </Animated.Text>
      </View>
    );
  }

  return <Text style={[styles.icon, { fontSize: size }]}>{emoji}</Text>;
}

const styles = StyleSheet.create({
  icon: {
    textAlign: 'center',
  },
  sparkleContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
