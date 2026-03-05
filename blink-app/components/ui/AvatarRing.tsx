import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated } from 'react-native';
import { Image } from 'expo-image';
import { theme } from '@/constants/colors';

interface AvatarRingProps {
  uri?: string | null;
  name?: string;
  size?: number;
  ringColor?: string;
  hasResponded?: boolean;
  isActive?: boolean;
  showStatus?: boolean;
}

const RING_WIDTH = 2.5;
const RING_GAP = 2;

export default React.memo(function AvatarRing({
  uri,
  name,
  size = 44,
  ringColor = theme.coral,
  hasResponded = false,
  isActive = false,
  showStatus = false,
}: AvatarRingProps) {
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isActive && showStatus) {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.5,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ]),
      );
      animation.start();
      return () => animation.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isActive, showStatus, pulseAnim]);

  const totalPadding = showStatus ? (RING_WIDTH + RING_GAP) * 2 : 0;
  const outerSize = size + totalPadding;
  const initial = name ? name.charAt(0).toUpperCase() : '?';

  const avatarContent = uri ? (
    <Image
      source={{ uri }}
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
      ]}
      contentFit="cover"
    />
  ) : (
    <View
      style={[
        styles.fallback,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: theme.coral,
        },
      ]}
    >
      <Text
        style={[
          styles.initial,
          { fontSize: size * 0.4 },
        ]}
      >
        {initial}
      </Text>
    </View>
  );

  if (!showStatus) {
    return <View style={{ width: size, height: size }}>{avatarContent}</View>;
  }

  const currentRingColor = hasResponded ? ringColor : theme.border;

  return (
    <Animated.View
      style={[
        styles.ringOuter,
        {
          width: outerSize,
          height: outerSize,
          borderRadius: outerSize / 2,
          borderWidth: RING_WIDTH,
          borderColor: currentRingColor,
          opacity: isActive ? pulseAnim : 1,
        },
      ]}
    >
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
        }}
      >
        {avatarContent}
      </View>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  ringOuter: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatar: {
    backgroundColor: theme.surface,
  },
  fallback: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  initial: {
    fontWeight: '700',
    color: theme.white,
  },
});
