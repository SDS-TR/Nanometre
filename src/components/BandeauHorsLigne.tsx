import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { Text } from './Text';

export function BandeauHorsLigne() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const subscription = NetInfo.addEventListener((state) => {
      setOffline(state.isConnected === false);
    });
    return () => subscription();
  }, []);
  if (!offline) {
    return null;
  }
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{ paddingTop: insets.top, paddingHorizontal: theme.space[4], paddingBottom: theme.space[2], backgroundColor: theme.color.warning.subtle }}
    >
      <Text variant="body-sm" color={theme.color.warning.onSubtle}>
        Hors ligne. Les informations déjà affichées restent visibles. Réessaie quand le réseau revient.
      </Text>
    </View>
  );
}
