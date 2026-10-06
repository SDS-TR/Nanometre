import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { Button } from '../src/components/Button';
import { Header } from '../src/components/Header';
import { Screen } from '../src/components/Screen';
import { Text } from '../src/components/Text';
import { useTheme } from '../src/theme';

export default function NotFoundScreen() {
  const theme = useTheme();
  const router = useRouter();
  return (
    <Screen>
      <Header title="Introuvable" />
      <View style={{ padding: theme.space[4], gap: theme.space[4] }}>
        <Text variant="heading-lg">Cette page n’existe pas.</Text>
        <Text variant="body-md" color={theme.color.text.secondary}>
          Le lien est peut-être ancien. Reviens à l’accueil du salon.
        </Text>
        <Button label="Retour à l’accueil" onPress={() => router.replace('/')} />
      </View>
    </Screen>
  );
}
