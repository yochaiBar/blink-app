import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Image, ImageProps } from 'expo-image';
import { theme } from '@/constants/colors';
import { usePhotoUri } from '@/hooks/usePhotoUri';

export interface EncryptedImageProps extends Omit<ImageProps, 'source'> {
  /** Response id whose photo to show, from the local photo store. */
  responseId?: string;
  /** On-device file to show until the stored copy is readable (e.g. the snap the user just took). */
  fallbackUri?: string | null;
}

/**
 * A response photo. Photos never come from the server: they are relayed
 * end-to-end and decrypted into the local photo store (usePhotoUri). Until
 * the copy is there, shows `fallbackUri` if given, else a flat skeleton —
 * useSocket invalidates ['localPhoto', responseId] when the photo lands and
 * the image swaps in.
 */
export default function EncryptedImage({ responseId, fallbackUri, style, ...imageProps }: EncryptedImageProps) {
  const localPhotoUri = usePhotoUri(responseId);
  const effectiveUri = localPhotoUri ?? fallbackUri;

  if (!effectiveUri) {
    return <View style={[styles.skeleton, style]} />;
  }

  return <Image source={{ uri: effectiveUri }} style={style} {...imageProps} />;
}

const styles = StyleSheet.create({
  skeleton: {
    backgroundColor: theme.bgCardSolid,
  },
});
