import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { versionBelow } from '../lib/version';
import { useTheme } from '../theme';
import { Text } from './Text';

function minimumVersion(): string {
  const extra = Constants.expoConfig?.extra as { minimumVersion?: string } | undefined;
  return extra?.minimumVersion ?? Constants.expoConfig?.version ?? '0.0.0';
}

/**
 * Si le binaire est plus ancien que `extra.minimumVersion`, on charge la mise à jour
 * OTA quand `expo-updates` est activé. Sinon l’écran bloque : il faut un build EAS.
 */
export function GardeVersion() {
  const theme = useTheme();
  const current = Constants.expoConfig?.version ?? '0.0.0';
  const outdated = versionBelow(current, minimumVersion());
  const [blocked, setBlocked] = useState(outdated && !Updates.isEnabled);

  useEffect(() => {
    if (!outdated || !Updates.isEnabled) {
      return;
    }
    Updates.checkForUpdateAsync()
      .then(async (result) => {
        if (!result.isAvailable) {
          setBlocked(true);
          return;
        }
        await Updates.fetchUpdateAsync();
        await Updates.reloadAsync();
      })
      .catch(() => setBlocked(true));
  }, [outdated]);

  if (!blocked) {
    return null;
  }
  return (
    <View
      accessibilityRole="alert"
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 20,
        justifyContent: 'center',
        padding: theme.space[6],
        gap: theme.space[3],
        backgroundColor: theme.color.bg.default,
      }}
    >
      <Text variant="heading-md">Cette version n’est plus prise en charge.</Text>
      <Text variant="body-md" color={theme.color.text.secondary}>
        Installe la mise à jour depuis l’App Store ou le Play Store pour continuer.
      </Text>
    </View>
  );
}
