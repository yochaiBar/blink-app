import React, { useRef, useCallback } from 'react';
import {
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  ActivityIndicator,
  Platform,
  ViewStyle,
  TextStyle,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { theme } from '@/constants/colors';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  icon?: React.ReactElement;
  fullWidth?: boolean;
}

const VARIANT_STYLES: Record<ButtonVariant, { container: ViewStyle; text: TextStyle }> = {
  primary: {
    container: { backgroundColor: theme.coral },
    text: { color: theme.white },
  },
  secondary: {
    container: { backgroundColor: theme.bgCard, borderWidth: 1, borderColor: theme.border },
    text: { color: theme.text },
  },
  ghost: {
    container: { backgroundColor: 'transparent' },
    text: { color: theme.text },
  },
  destructive: {
    container: { backgroundColor: theme.red },
    text: { color: theme.white },
  },
};

const SIZE_STYLES: Record<ButtonSize, { container: ViewStyle; text: TextStyle; iconGap: number }> = {
  sm: {
    container: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10 },
    text: { fontSize: 13, fontWeight: '600' as const },
    iconGap: 6,
  },
  md: {
    container: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 12 },
    text: { fontSize: 15, fontWeight: '700' as const },
    iconGap: 8,
  },
  lg: {
    container: { paddingVertical: 16, paddingHorizontal: 28, borderRadius: 14 },
    text: { fontSize: 16, fontWeight: '700' as const },
    iconGap: 10,
  },
};

const DISABLED_OPACITY = 0.45;

export default React.memo(function Button({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  fullWidth = false,
}: ButtonProps) {
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const handlePressIn = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 0.96,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  }, [scaleAnim]);

  const handlePressOut = useCallback(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      speed: 50,
      bounciness: 4,
    }).start();
  }, [scaleAnim]);

  const handlePress = useCallback(() => {
    if (loading || disabled) return;
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    onPress();
  }, [onPress, loading, disabled]);

  const variantStyle = VARIANT_STYLES[variant];
  const sizeStyle = SIZE_STYLES[size];

  const spinnerColor = variant === 'primary' || variant === 'destructive'
    ? theme.white
    : theme.textSecondary;

  return (
    <Animated.View style={{ transform: [{ scale: scaleAnim }], alignSelf: fullWidth ? 'stretch' : 'auto' }}>
      <TouchableOpacity
        style={[
          styles.base,
          variantStyle.container,
          sizeStyle.container,
          fullWidth && styles.fullWidth,
          (disabled || loading) && { opacity: DISABLED_OPACITY },
        ]}
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
        disabled={disabled || loading}
        testID={`button-${title.toLowerCase().replace(/\s+/g, '-')}`}
      >
        {loading ? (
          <ActivityIndicator size="small" color={spinnerColor} />
        ) : (
          <>
            {icon && <Animated.View style={{ marginRight: sizeStyle.iconGap }}>{icon}</Animated.View>}
            <Text style={[styles.text, variantStyle.text, sizeStyle.text]}>{title}</Text>
          </>
        )}
      </TouchableOpacity>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  base: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fullWidth: {
    width: '100%',
  },
  text: {
    letterSpacing: -0.2,
  },
});
