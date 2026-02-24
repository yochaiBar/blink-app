import React, { useRef, useEffect } from 'react';
import { Animated, DimensionValue, StyleSheet, ViewStyle } from 'react-native';
import { theme } from '@/constants/colors';

type SkeletonVariant = 'circle' | 'rect' | 'text';

interface SkeletonProps {
  variant?: SkeletonVariant;
  width?: DimensionValue;
  height?: DimensionValue;
  borderRadius?: number;
  style?: ViewStyle;
}

function getDefaultProps(variant: SkeletonVariant): { width: DimensionValue; height: DimensionValue; borderRadius: number } {
  switch (variant) {
    case 'circle':
      return { width: 40, height: 40, borderRadius: 20 };
    case 'text':
      return { width: '100%', height: 14, borderRadius: 7 };
    case 'rect':
    default:
      return { width: '100%', height: 80, borderRadius: 12 };
  }
}

export default React.memo(function Skeleton({
  variant = 'rect',
  width,
  height,
  borderRadius,
  style,
}: SkeletonProps) {
  const pulseAnim = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.7,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [pulseAnim]);

  const defaults = getDefaultProps(variant);

  return (
    <Animated.View
      style={[
        styles.base,
        {
          width: width ?? defaults.width,
          height: height ?? defaults.height,
          borderRadius: borderRadius ?? defaults.borderRadius,
          opacity: pulseAnim,
        },
        style,
      ]}
    />
  );
});

const styles = StyleSheet.create({
  base: {
    backgroundColor: theme.surfaceLight,
  },
});
