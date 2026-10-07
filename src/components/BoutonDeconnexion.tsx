import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { confirmerPuisDeconnecter } from '../admin/deconnexion';
import { useAppState } from '../providers/AppState';
import { useTheme } from '../theme';
import { Button } from './Button';
import { Text } from './Text';

export function BoutonDeconnexion() {
  const theme = useTheme();
  const router = useRouter();
  const { repo } = useAppState();
  const [arme, setArme] = useState(false);
  const label = arme ? 'Confirmer la déconnexion' : 'Déconnexion';
  return (
    <View style={{ gap: theme.space[2] }}>
      {repo.mode === 'supabase' ? (
        <Text variant="body-sm" color={theme.color.text.secondary}>
          La déconnexion ferme la session sur tous les appareils.
        </Text>
      ) : null}
      {arme ? (
        <Text variant="body-sm" color={theme.color.text.secondary}>
          Appuie encore pour quitter ce compte.
        </Text>
      ) : null}
      <Button
        label={label}
        variant="ghost"
        accessibilityLabel={label}
        onPress={() => {
          void confirmerPuisDeconnecter(
            () => {
              if (!arme) {
                setArme(true);
                return false;
              }
              return true;
            },
            repo,
            (path) => {
              router.replace(path);
            },
          );
        }}
      />
    </View>
  );
}
