import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { Button } from '../src/components/Button';
import { Header } from '../src/components/Header';
import { Screen } from '../src/components/Screen';
import { Text } from '../src/components/Text';
import { useTheme } from '../src/theme';

export default function SuppressionScreen() {
  const theme = useTheme();
  const router = useRouter();
  return (
    <Screen>
      <Header back title="Suppression du compte" />
      <View style={{ padding: theme.space[4], gap: theme.space[4] }}>
        <Text variant="heading-lg">Fermer ton compte</Text>
        <Text variant="body-md" color={theme.color.text.secondary}>
          Depuis le profil, une fois connecté, choisis « Supprimer mon compte » et écris SUPPRIMER. Les rendez-vous à venir sont annulés et remboursés s’ils ont été payés. Les reçus exigés par la loi fiscale restent, sans ton nom.
        </Text>
        <Button label="Aller au profil" onPress={() => router.push('/profil')} />
      </View>
    </Screen>
  );
}
