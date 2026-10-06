import { View } from 'react-native';
import { Header } from '../../../../src/components/Header';
import { PanneauClients } from '../../../../src/components/PanneauClients';
import { Screen } from '../../../../src/components/Screen';
import { StateMessage } from '../../../../src/components/StateView';
import { useAppState } from '../../../../src/providers/AppState';
import { useTheme } from '../../../../src/theme';

export default function GestionClientsScreen() {
  const theme = useTheme();
  const { user } = useAppState();
  if (user?.role !== 'proprietaire') {
    return (
      <Screen>
        <Header back title="Clients" />
        <StateMessage title="Accès refusé" body="Le dossier complet, avec les montants, est réservé au propriétaire." />
      </Screen>
    );
  }
  return (
    <Screen scroll={false}>
      <Header back title="Clients" />
      <View style={{ flex: 1, padding: theme.space[4] }}>
        <PanneauClients />
      </View>
    </Screen>
  );
}
