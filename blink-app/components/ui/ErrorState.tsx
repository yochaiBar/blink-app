import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { AlertTriangle } from 'lucide-react-native';
import { theme } from '@/constants/colors';
import Button from './Button';

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
  compact?: boolean;
}

export default React.memo(function ErrorState({
  message = 'Something went wrong',
  onRetry,
  compact = false,
}: ErrorStateProps) {
  if (compact) {
    return (
      <View style={styles.compactContainer}>
        <AlertTriangle size={18} color={theme.red} />
        <Text style={styles.compactMessage} numberOfLines={2}>{message}</Text>
        {onRetry && (
          <Button title="Retry" onPress={onRetry} variant="ghost" size="sm" />
        )}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.iconCircle}>
        <AlertTriangle size={28} color={theme.red} />
      </View>
      <Text style={styles.title}>Oops!</Text>
      <Text style={styles.message}>{message}</Text>
      {onRetry && (
        <View style={styles.retryWrapper}>
          <Button title="Try Again" onPress={onRetry} variant="primary" size="md" />
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 32,
  },
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: theme.redMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: theme.text,
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    color: theme.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  retryWrapper: {
    marginTop: 20,
  },
  compactContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: theme.redMuted,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginVertical: 8,
  },
  compactMessage: {
    flex: 1,
    fontSize: 13,
    color: theme.text,
    fontWeight: '500' as const,
  },
});
