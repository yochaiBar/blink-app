import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Image, ImageProps } from 'expo-image';
import { useQuery } from '@tanstack/react-query';
import { theme } from '@/constants/colors';
import { getReceivedPhotoUri } from '@/services/photoStore';

export interface EncryptedImageProps extends Omit<ImageProps, 'source'> {
  /** v1 photo_url (S3) — fallback while v1 rows still exist. Null for v2 responses. */
  uri: string | null;
  /** Response id used to look up the v2 local-sandbox copy. */
  responseId?: string;
}

/**
 * Resolve a photo URI to render. Component name kept ("EncryptedImage")
 * for backwards compat with existing callers (SnapCard, PhotoTimeline,
 * challenge-reveal). What it actually does now:
 *
 *   1. If responseId is given, look up the local sandbox via photoStore
 *      (v2 photo flow — bytes were delivered via /api/photos/relay and
 *      decrypted on this device).
 *   2. Else fall back to the v1 `uri` (S3 URL) — covers any rows that
 *      pre-date the cutover until migration 015 drops photo_url.
 *   3. Else render a flat skeleton — happens during the brief gap
 *      between a response event arriving and the photo:incoming socket
 *      frame landing. useSocket invalidates ['localPhoto', responseId]
 *      on successful receive; this query re-runs and the Image swaps in.
 */
export default function EncryptedImage({
  uri,
  responseId,
  style,
  ...imageProps
}: EncryptedImageProps) {
  const localPhotoQuery = useQuery({
    queryKey: ['localPhoto', responseId],
    queryFn: () => (responseId ? getReceivedPhotoUri(responseId) : null),
    enabled: !!responseId,
    staleTime: 30_000,
  });
  const effectiveUri = localPhotoQuery.data ?? uri;

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
