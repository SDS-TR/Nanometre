import { View } from 'react-native';
import { Header } from '../../../../src/components/Header';
import { PanneauAvis } from '../../../../src/components/PanneauAvis';
import { Screen } from '../../../../src/components/Screen';
import { StateMessage } from '../../../../src/components/StateView';
import { useAppState } from '../../../../src/providers/AppState';
import { useTheme } from '../../../../src/theme';

export default function GestionAvisScreen() {
  const theme = useTheme();
  const { user } = useAppState();
  if (user?.role !== 'proprietaire') {
    return (
      <Screen>
        <Header back title="Avis" />
        <StateMessage title="Accès refusé" body="Seul le propriétaire modère les avis." />
      </Screen>
    );
  }
  return (
    <Screen>
      <Header back title="Avis" />
      <View style={{ padding: theme.space[4] }}>
        <PanneauAvis moderate />
      </View>
    </Screen>
  );
}
