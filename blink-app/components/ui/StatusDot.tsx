import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';
import { theme } from '@/constants/colors';

interface StatusDotProps {
  color?: string;
  size?: number;
  pulse?: boolean;
}

export default React.memo(function StatusDot({
  color = theme.green,
  size = 8,
  pulse = false,
}: StatusDotProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (pulse) {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.parallel([
            Animated.timing(scaleAnim, {
              toValue: 1.6,
              duration: 1000,
              useNativeDriver: true,
            }),
            Animated.timing(opacityAnim, {
              toValue: 0.3,
              duration: 1000,
              useNativeDriver: true,
            }),
          ]),
          Animated.parallel([
            Animated.timing(scaleAnim, {
              toValue: 1,
              duration: 1000,
              useNativeDriver: true,
            }),
            Animated.timing(opacityAnim, {
              toValue: 1,
              duration: 1000,
              useNativeDriver: true,
            }),
          ]),
        ]),
      );
      animation.start();
      return () => animation.stop();
    } else {
      scaleAnim.setValue(1);
      opacityAnim.setValue(1);
    }
  }, [pulse, scaleAnim, opacityAnim]);

  return (
    <Animated.View
      style={[
        styles.dot,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          transform: [{ scale: scaleAnim }],
          opacity: opacityAnim,
        },
      ]}
    />
  );
});

const styles = StyleSheet.create({
  dot: {},
});
