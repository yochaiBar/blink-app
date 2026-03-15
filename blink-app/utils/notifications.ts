import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { registerPushToken } from '@/services/api';

Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data as Record<string, string | undefined> | undefined;
    // Always show challenge notifications prominently (even when app is in foreground)
    const isChallenge = data?.type === 'challenge_started' || data?.type === 'challenge' || data?.screen === 'challenge';
    return {
      shouldShowAlert: true,
      shouldPlaySound: isChallenge ? true : true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    };
  },
});

export async function registerForPushNotifications(): Promise<string | null> {
  if (Platform.OS === 'web') {
    // console.log('[Notifications] Push notifications not supported on web');
    return null;
  }

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      // console.log('[Notifications] Permission not granted');
      return null;
    }

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

    if (!projectId) {
      // console.log('[Notifications] No project ID found, using device token');
      const tokenData = await Notifications.getDevicePushTokenAsync();
      // console.log('[Notifications] Device push token:', tokenData.data);
      return tokenData.data;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    // console.log('[Notifications] Expo push token:', tokenData.data);
    return tokenData.data;
  } catch {
    // Non-critical: push token registration is best-effort
    return null;
  }
}

export async function schedulePushNotification(title: string, body: string, seconds: number = 1): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true },
      trigger: Platform.OS === 'web' ? null : { seconds, type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL },
    });
    // console.log('[Notifications] Scheduled:', title);
  } catch {
    // Non-critical: scheduling a local notification is best-effort
  }
}

export function addNotificationListener(
  onReceived: (notification: Notifications.Notification) => void,
  onResponse: (response: Notifications.NotificationResponse) => void,
): () => void {
  const receivedSub = Notifications.addNotificationReceivedListener(onReceived);
  const responseSub = Notifications.addNotificationResponseReceivedListener(onResponse);

  return () => {
    receivedSub.remove();
    responseSub.remove();
  };
}

export async function setBadgeCount(count: number): Promise<void> {
  if (Platform.OS === 'web') return;
  try {
    await Notifications.setBadgeCountAsync(count);
  } catch {
    // Non-critical: badge count is cosmetic, ignore failure
  }
}

/**
 * Registers the device push token with the backend.
 * Fire-and-forget — errors are silently swallowed so the UI is never blocked.
 * Safe to call repeatedly; the backend upserts the token.
 */
export async function sendPushTokenToServer(): Promise<void> {
  if (Platform.OS === 'web') return;

  try {
    const token = await registerForPushNotifications();
    if (token) {
      await registerPushToken(token);
    }
  } catch {
    // Fire-and-forget: don't block the app if token registration fails
  }
}

/**
 * Extracts the notification data payload and returns a route path
 * for expo-router navigation, or null if the payload is unrecognised.
 */
/**
 * Quiz challenge types that should route to the quiz screen.
 */
const QUIZ_TYPES = new Set(['quiz', 'quiz_food', 'quiz_most_likely', 'quiz_rate_day']);

/**
 * Extracts the notification data payload and returns a route path
 * for expo-router navigation, or null if the payload is unrecognised.
 *
 * Challenge notifications route directly to the challenge screen (camera or quiz)
 * instead of the group detail page — this is the "camera-first" flow.
 */
export function getNotificationRoute(
  data: Record<string, string | undefined> | undefined,
): { pathname: string; params?: Record<string, string> } | null {
  if (!data || !data.type) return null;

  switch (data.type) {
    case 'challenge_started':
    case 'challenge': {
      const groupId = data.groupId;
      const challengeId = data.challengeId;
      const challengeType = data.challengeType;

      // If we have both groupId and challengeId, route directly to the challenge screen
      if (groupId && challengeId) {
        if (challengeType && QUIZ_TYPES.has(challengeType)) {
          return {
            pathname: '/quiz-challenge',
            params: { groupId, challengeId },
          };
        }
        // Default: snap challenge (camera-first)
        return {
          pathname: '/snap-challenge',
          params: { groupId, challengeId },
        };
      }

      // Fallback: if we only have groupId, go to group detail
      if (groupId) {
        return {
          pathname: '/group-detail',
          params: { id: groupId },
        };
      }
      return null;
    }

    // Also handle the explicit screen routing (data.screen === 'challenge')
    // This covers cases where the backend sends screen-based routing data
    default:
      break;
  }

  // Handle screen-based routing (alternative payload format)
  if (data.screen === 'challenge' && data.groupId && data.challengeId) {
    if (data.challengeType && QUIZ_TYPES.has(data.challengeType)) {
      return {
        pathname: '/quiz-challenge',
        params: { groupId: data.groupId, challengeId: data.challengeId },
      };
    }
    return {
      pathname: '/snap-challenge',
      params: { groupId: data.groupId, challengeId: data.challengeId },
    };
  }

  switch (data.type) {
    case 'group':
      if (data.groupId) {
        return {
          pathname: '/group-detail',
          params: { id: data.groupId },
        };
      }
      return null;

    case 'reaction':
      if (data.groupId) {
        return {
          pathname: '/group-detail',
          params: { id: data.groupId },
        };
      }
      // If no groupId, fall through to home
      return { pathname: '/' };

    default:
      return null;
  }
}
