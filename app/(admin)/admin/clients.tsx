import { View } from 'react-native';
import { Header } from '../../../src/components/Header';
import { PanneauClients } from '../../../src/components/PanneauClients';
import { Screen } from '../../../src/components/Screen';
import { StateMessage } from '../../../src/components/StateView';
import { useAppState } from '../../../src/providers/AppState';
import { useTheme } from '../../../src/theme';

export default function ClientsScreen() {
  const theme = useTheme();
  const { user } = useAppState();
  if (user?.role === 'proprietaire') {
    return (
      <Screen>
        <Header title="Clients" />
        <StateMessage title="Accès refusé" body="Les dossiers clients du propriétaire sont dans Gestion." />
      </Screen>
    );
  }
  return (
    <Screen>
      <Header title="Clients" />
      <View style={{ padding: theme.space[4] }}>
        <PanneauClients />
      </View>
    </Screen>
  );
}
