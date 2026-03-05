import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Dimensions } from 'react-native';
import { theme } from '@/constants/colors';

export interface StreakCelebrationProps {
  visible: boolean;
  userName: string;
  streakDays: number;
  onDismiss: () => void;
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

const CONFETTI_COLORS = [
  theme.coral,
  theme.yellow,
  theme.green,
  theme.blue,
  theme.purple,
  theme.pink,
];

const CONFETTI_COUNT = 24;

function ConfettiPiece({ delay, color, startX }: { delay: number; color: string; startX: number }) {
  const fallAnim = useRef(new Animated.Value(0)).current;
  const rotateAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const fall = Animated.timing(fallAnim, {
      toValue: 1,
      duration: 2500,
      delay,
      useNativeDriver: true,
    });
    const rotate = Animated.timing(rotateAnim, {
      toValue: 1,
      duration: 2500,
      delay,
      useNativeDriver: true,
    });
    Animated.parallel([fall, rotate]).start();
  }, [fallAnim, rotateAnim, delay]);

  const translateY = fallAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-20, SCREEN_HEIGHT + 20],
  });

  const translateX = fallAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 100],
  });

  const rotate = rotateAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', `${360 + Math.random() * 360}deg`],
  });

  const opacity = fallAnim.interpolate({
    inputRange: [0, 0.1, 0.8, 1],
    outputRange: [0, 1, 1, 0],
  });

  return (
    <Animated.View
      style={[
        styles.confettiPiece,
        {
          left: startX,
          backgroundColor: color,
          width: 6 + Math.random() * 6,
          height: 6 + Math.random() * 6,
          borderRadius: Math.random() > 0.5 ? 10 : 2,
          opacity,
          transform: [{ translateY }, { translateX }, { rotate }],
        },
      ]}
    />
  );
}

export default function StreakCelebration({
  visible,
  userName,
  streakDays,
  onDismiss,
}: StreakCelebrationProps) {
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 50,
          friction: 7,
          useNativeDriver: true,
        }),
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      const timer = setTimeout(() => {
        Animated.timing(fadeAnim, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }).start(() => {
          scaleAnim.setValue(0);
          onDismiss();
        });
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [visible, scaleAnim, fadeAnim, onDismiss]);

  if (!visible) return null;

  const confettiPieces = Array.from({ length: CONFETTI_COUNT }).map((_, i) => ({
    delay: Math.random() * 500,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    startX: Math.random() * SCREEN_WIDTH,
  }));

  return (
    <Animated.View style={[styles.overlay, { opacity: fadeAnim }]} pointerEvents="none">
      {confettiPieces.map((props, i) => (
        <ConfettiPiece key={i} {...props} />
      ))}
      <Animated.View
        style={[
          styles.card,
          { transform: [{ scale: scaleAnim }] },
        ]}
      >
        <Text style={styles.emoji}>{'\uD83D\uDD25'}</Text>
        <Text style={styles.title}>
          {userName} hit a {streakDays}-day streak!
        </Text>
        <Text style={styles.subtitle}>Incredible dedication!</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  card: {
    backgroundColor: theme.bgCard,
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    gap: 12,
    maxWidth: 300,
    borderWidth: 1,
    borderColor: theme.coral,
  },
  emoji: {
    fontSize: 48,
  },
  title: {
    fontSize: 20,
    fontWeight: '800',
    color: theme.text,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 14,
    color: theme.textSecondary,
    fontWeight: '600',
  },
  confettiPiece: {
    position: 'absolute',
    top: 0,
  },
});
