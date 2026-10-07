import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { blockedByRemoteFloor } from '../lib/version';
import { useAppState } from '../providers/AppState';
import { useTheme } from '../theme';
import { Text } from './Text';

/**
 * Compare la version du binaire au plancher publié par le serveur (`salon_public.minAppVersion`).
 * La config embarquée ne sert pas de plancher : un binaire ne peut pas se déclarer trop vieux.
 * Les mises à jour OTA restent désactivées tant que `updates.enabled` est faux.
 */
export function GardeVersion() {
  const theme = useTheme();
  const { repo, ready } = useAppState();
  const current = Constants.expoConfig?.version ?? '0.0.0';
  const [blocked, setBlocked] = useState(false);

  useEffect(() => {
    if (!ready) {
      return undefined;
    }
    let cancelled = false;
    repo
      .getSalon()
      .then((salon) => {
        if (cancelled || !blockedByRemoteFloor(current, salon.minAppVersion)) {
          return;
        }
        if (!Updates.isEnabled) {
          setBlocked(true);
          return;
        }
        return Updates.checkForUpdateAsync().then(async (result) => {
          if (!result.isAvailable) {
            setBlocked(true);
            return;
          }
          await Updates.fetchUpdateAsync();
          await Updates.reloadAsync();
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [ready, repo, current]);

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
