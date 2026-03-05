import React from 'react';
import { View, StyleSheet, Platform, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { theme } from '@/constants/colors';

interface GlassCardProps {
  children: React.ReactNode;
  style?: ViewStyle;
  intensity?: number;
  borderRadius?: number;
  padding?: number;
  noBorder?: boolean;
}

export default React.memo(function GlassCard({
  children,
  style,
  intensity = 40,
  borderRadius = 20,
  padding = 16,
  noBorder = false,
}: GlassCardProps) {
  const borderStyle: ViewStyle = noBorder
    ? {}
    : { borderWidth: 1, borderColor: theme.glassBorder };

  // Android fallback: BlurView can be unreliable, use solid background instead
  if (Platform.OS === 'android') {
    return (
      <View
        style={[
          styles.container,
          {
            borderRadius,
            backgroundColor: theme.bgCardSolid,
          },
          borderStyle,
          style,
        ]}
      >
        <View style={{ padding }}>{children}</View>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        { borderRadius },
        borderStyle,
        style,
      ]}
    >
      <BlurView
        intensity={intensity}
        tint="dark"
        style={[StyleSheet.absoluteFill, { borderRadius }]}
      />
      {/* Subtle top highlight for depth */}
      <LinearGradient
        colors={[theme.glassHighlight, 'transparent']}
        style={[styles.highlight, { borderTopLeftRadius: borderRadius, borderTopRightRadius: borderRadius }]}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        pointerEvents="none"
      />
      <View style={{ padding }}>{children}</View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    overflow: 'hidden',
  },
  highlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 40,
  },
});
