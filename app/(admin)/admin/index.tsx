import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { Badge } from '../../../src/components/Badge';
import { Button } from '../../../src/components/Button';
import { Header } from '../../../src/components/Header';
import { Screen } from '../../../src/components/Screen';
import { Text } from '../../../src/components/Text';
import { useAppState } from '../../../src/providers/AppState';
import { useTheme } from '../../../src/theme';

export default function AdminStubScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAppState();
  return (
    <Screen>
      <Header title="Espace équipe" />
      <View style={{ padding: theme.space[4], gap: theme.space[3] }}>
        <Badge label={user?.role === 'proprietaire' ? 'Propriétaire' : 'Coiffeur'} tone="accent" />
        <Text variant="heading-lg">Phase 2</Text>
        <Text variant="body-md" color={theme.color.text.secondary}>
          Le tableau de bord, l’agenda, les paiements et la gestion restent à construire. Les droits sont déjà décrits dans la base : un coiffeur ne voit que sa chaise, sans montant.
        </Text>
        <Button label="Retour à l’accueil" variant="secondary" onPress={() => router.replace('/')} />
      </View>
    </Screen>
  );
}
