import { View } from 'react-native';
import { Header } from '../../../src/components/Header';
import { PanneauAvis } from '../../../src/components/PanneauAvis';
import { Screen } from '../../../src/components/Screen';
import { StateMessage } from '../../../src/components/StateView';
import { useAppState } from '../../../src/providers/AppState';
import { useTheme } from '../../../src/theme';

export default function AvisScreen() {
  const theme = useTheme();
  const { user } = useAppState();
  if (user?.role !== 'coiffeur') {
    return (
      <Screen>
        <Header title="Avis" />
        <StateMessage title="Accès refusé" body="La modération des avis est dans Gestion." />
      </Screen>
    );
  }
  return (
    <Screen>
      <Header title="Avis" />
      <View style={{ padding: theme.space[4] }}>
        <PanneauAvis moderate={false} />
      </View>
    </Screen>
  );
}
