import { RefObject } from 'react';
import { Alert, Platform, Share } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import * as MediaLibrary from 'expo-media-library';
import type { View } from 'react-native';

/**
 * Captures the ShareCard component as a high-resolution PNG.
 * The ref should point to the View that wraps the ShareCard.
 */
export async function captureShareCard(
  viewRef: RefObject<View>,
): Promise<string> {
  if (!viewRef.current) {
    throw new Error('Share card view ref is not available');
  }

  const uri = await captureRef(viewRef, {
    format: 'png',
    quality: 1,
    result: 'tmpfile',
  });

  return uri;
}

/**
 * Opens the native share sheet with the captured image.
 */
export async function shareImage(uri: string): Promise<void> {
  const isAvailable = await Sharing.isAvailableAsync();

  if (isAvailable) {
    await Sharing.shareAsync(uri, {
      mimeType: 'image/png',
      dialogTitle: 'Share your Blink',
    });
  } else if (Platform.OS !== 'web') {
    // Fallback to RN Share for platforms where expo-sharing is unavailable
    await Share.share({ url: uri });
  } else {
    Alert.alert('Sharing is not available on this device');
  }
}

/**
 * Saves the captured image to the device camera roll.
 * Requests permission if not already granted.
 */
export async function saveToCameraRoll(uri: string): Promise<boolean> {
  const { status } = await MediaLibrary.requestPermissionsAsync();

  if (status !== 'granted') {
    Alert.alert(
      'Permission Required',
      'Please allow access to your photo library to save images.',
    );
    return false;
  }

  await MediaLibrary.saveToLibraryAsync(uri);
  return true;
}
