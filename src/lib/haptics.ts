import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

function native(task: () => Promise<void>) {
  if (Platform.OS === 'web') {
    return;
  }
  void task().catch(() => undefined);
}

export function hapticSelect() {
  native(() => Haptics.selectionAsync());
}

export function hapticSuccess() {
  native(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

export function hapticError() {
  native(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}
