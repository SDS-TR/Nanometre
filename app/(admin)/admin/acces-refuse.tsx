import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { BoutonDeconnexion } from '../../../src/components/BoutonDeconnexion';
import { Button } from '../../../src/components/Button';
import { Header } from '../../../src/components/Header';
import { Screen } from '../../../src/components/Screen';
import { Text } from '../../../src/components/Text';
import { useTheme } from '../../../src/theme';

export default function AccesRefuseScreen() {
  const theme = useTheme();
  const router = useRouter();
  return (
    <Screen>
      <Header title="Espace équipe" />
      <View style={{ padding: theme.space[4], gap: theme.space[3] }}>
        <Text variant="display-lg">Accès refusé</Text>
        <Text variant="body-lg" color={theme.color.text.secondary}>
          Ton compte n’ouvre pas l’espace équipe. Si tu fais partie du salon, connecte-toi avec le compte qui t’a été remis.
        </Text>
        <Button label="Retour à l’accueil" onPress={() => router.replace('/')} />
        <BoutonDeconnexion />
      </View>
    </Screen>
  );
}
