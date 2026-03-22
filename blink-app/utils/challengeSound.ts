import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';

/**
 * Tracks whether we recently fired a local challenge ring so the notification
 * handler can suppress duplicate banners from the server push notification.
 */
let _recentRingTimestamp = 0;

/** How long (ms) to suppress duplicate challenge push banners after a local ring. */
const DEDUP_WINDOW_MS = 5_000;

/**
 * Returns true if a local challenge ring was played within the dedup window.
 * Used by the notification handler to avoid showing a duplicate banner
 * when the server push arrives shortly after the socket event.
 */
export function wasRecentChallengeRing(): boolean {
  return Date.now() - _recentRingTimestamp < DEDUP_WINDOW_MS;
}

/**
 * Play a distinctive alert sound + haptic feedback when a challenge starts.
 *
 * Fires an immediate local notification (with the system default sound) and
 * a burst of haptic impacts to create an urgent, ringtone-like alert.
 *
 * The notification is tagged with `_challenge_ring: 'true'` so the foreground
 * handler can identify it.
 */
export async function playChallengeRing(): Promise<void> {
  if (Platform.OS === 'web') return;

  _recentRingTimestamp = Date.now();

  // 1. Haptic burst -- multiple impacts for a "ringing" feel
  try {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    setTimeout(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    }, 300);
    setTimeout(() => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    }, 600);
  } catch {
    // Haptics not available -- continue silently
  }

  // 2. Immediate local notification with default system sound
  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Challenge Time!',
        body: 'A new challenge just started -- snap now!',
        sound: true,
        data: { _challenge_ring: 'true' },
        priority: Notifications.AndroidNotificationPriority.HIGH,
      },
      trigger: null,
    });
  } catch {
    // Sound playback is best-effort -- never block the app
  }
}
