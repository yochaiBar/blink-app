import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, TouchableOpacity, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Camera, X } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '@/constants/colors';
import { typography } from '@/constants/typography';
import { spacing, borderRadius } from '@/constants/spacing';
import { DEMO_GROUP_ID, DEMO_CHALLENGE } from '@/constants/demoData';
import { useOnboardingStore } from '@/stores/onboardingStore';

interface Props {
  visible: boolean;
  onDismiss: () => void;
}

export default function DemoChallengeAlert({ visible, onDismiss }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(false);

  const promptText = DEMO_CHALLENGE.prompt_text ?? DEMO_CHALLENGE.prompt ?? 'Show us your view right now!';

  useEffect(() => {
    if (!visible) {
      // Hide
      Animated.parallel([
        Animated.timing(translateY, { toValue: -120, duration: 300, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start(() => setShown(false));
      return;
    }

    // Show after 3-second delay
    const showTimeout = setTimeout(() => {
      setShown(true);
      Animated.parallel([
        Animated.timing(translateY, { toValue: 0, duration: 400, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      ]).start();

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
    }, 3000);

    // Auto-hide after 10 seconds (3s delay + 10s visible = 13s total)
    const hideTimeout = setTimeout(() => {
      Animated.parallel([
        Animated.timing(translateY, { toValue: -120, duration: 300, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
      ]).start(() => {
        setShown(false);
        onDismiss();
      });
    }, 13000);

    return () => {
      clearTimeout(showTimeout);
      clearTimeout(hideTimeout);
    };
  }, [visible]);

  const handlePress = () => {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    onDismiss();
    router.push({
      pathname: '/snap-challenge' as never,
      params: {
        groupId: DEMO_GROUP_ID,
        challengeId: 'demo_challenge_1',
      },
    });
  };

  const handleDismiss = () => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: -120, duration: 300, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => {
      setShown(false);
      onDismiss();
    });
  };

  if (!visible && !shown) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          top: insets.top + spacing.sm,
          transform: [{ translateY }],
          opacity,
        },
      ]}
      pointerEvents="box-none"
    >
      <TouchableOpacity activeOpacity={0.9} onPress={handlePress} style={styles.touchable}>
        <LinearGradient
          colors={[theme.coral, theme.coralDark]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.gradient}
        >
          <View style={styles.content}>
            <View style={styles.iconContainer}>
              <Camera size={20} color={theme.white} />
            </View>
            <View style={styles.textContainer}>
              <Text style={styles.title}>Welcome Crew</Text>
              <Text style={styles.prompt} numberOfLines={1}>{promptText}</Text>
              <Text style={styles.subtitle}>Tap to respond</Text>
            </View>
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={handleDismiss}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <X size={16} color="rgba(255,255,255,0.7)" />
            </TouchableOpacity>
          </View>
        </LinearGradient>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 1000,
  },
  touchable: {
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    shadowColor: theme.coral,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  gradient: {
    borderRadius: borderRadius.lg,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.lg,
    gap: spacing.md,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  textContainer: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...typography.bodyBold,
    color: theme.white,
  },
  prompt: {
    ...typography.bodyMedium,
    color: 'rgba(255,255,255,0.9)',
  },
  subtitle: {
    ...typography.caption,
    color: 'rgba(255,255,255,0.7)',
    marginTop: 2,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
