import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
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
  } catch (error) {
    // console.log('[Notifications] Error registering:', error);
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
  } catch (error) {
    // console.log('[Notifications] Schedule error:', error);
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
  } catch (error) {
    // console.log('[Notifications] Badge error:', error);
  }
}
