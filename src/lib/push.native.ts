import { isRunningInExpoGo } from 'expo';
import { remotePushSupported } from './pushAvailability';

/** Expo Go : aucun import de expo-notifications. Dev build et EAS : jeton Expo. */
export async function registerForPush(): Promise<string | null> {
  if (!remotePushSupported({ runningInExpoGo: isRunningInExpoGo() })) {
    return null;
  }
  const Notifications = await import('expo-notifications');
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  const existing = await Notifications.getPermissionsAsync();
  const granted = existing.granted || (await Notifications.requestPermissionsAsync()).granted;
  if (!granted) {
    return null;
  }
  const token = await Notifications.getExpoPushTokenAsync();
  return token.data;
}
