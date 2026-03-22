import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Image, ImageProps } from 'expo-image';
import { useDecryptedPhoto } from '@/hooks/useDecryptedPhoto';
import { theme } from '@/constants/colors';
import type { EncryptionMetadata } from '@/types/api';

export interface EncryptedImageProps extends Omit<ImageProps, 'source'> {
  uri: string | null;
  encryptionMetadata?: EncryptionMetadata | null;
  groupId?: string;
  responseId?: string;
}

/**
 * Drop-in replacement for expo-image that transparently decrypts E2E encrypted photos.
 * If no encryption_metadata is provided, renders the image directly.
 */
export default function EncryptedImage({
  uri,
  encryptionMetadata,
  groupId,
  responseId,
  style,
  ...imageProps
}: EncryptedImageProps) {
  const { uri: resolvedUri, loading } = useDecryptedPhoto(
    uri,
    encryptionMetadata,
    groupId,
    responseId,
  );

  if (loading) {
    return (
      <View style={[styles.shimmer, style]}>
        <ActivityIndicator size="small" color={theme.textMuted} />
      </View>
    );
  }

  if (!resolvedUri) {
    return <View style={[styles.shimmer, style]} />;
  }

  return (
    <Image
      source={{ uri: resolvedUri }}
      style={style}
      {...imageProps}
    />
  );
}

const styles = StyleSheet.create({
  shimmer: {
    backgroundColor: theme.surface,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
