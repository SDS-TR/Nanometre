import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { CarteCoiffeur } from '../../src/components/CarteCoiffeur';
import { Header } from '../../src/components/Header';
import { Screen } from '../../src/components/Screen';
import { LoadingBlock, StateMessage } from '../../src/components/StateView';
import { Text } from '../../src/components/Text';
import { useAsync } from '../../src/hooks/useAsync';
import { useTheme } from '../../src/theme';

export default function CoiffeursScreen() {
  const theme = useTheme();
  const router = useRouter();
  const query = useAsync((repo) => repo.getBarbers(), []);
  return (
    <Screen>
      <Header title="Coiffeurs" />
      <View style={{ padding: theme.space[4], gap: theme.space[4] }}>
        <Text variant="body-md" color={theme.color.text.secondary}>
          Cinq barbiers, une seule adresse. Choisis une chaise ou laisse-nous te placer.
        </Text>
        {query.status === 'loading' ? <LoadingBlock /> : null}
        {query.status === 'error' ? (
          <StateMessage title="Impossible de charger l’équipe" body={query.error ?? ''} actionLabel="Réessayer" onAction={query.reload} />
        ) : null}
        {query.status === 'ready' && query.data?.length === 0 ? (
          <StateMessage title="Aucun coiffeur pour l’instant" body="Reviens un peu plus tard." />
        ) : null}
        {query.data?.map((barber) => (
          <CarteCoiffeur key={barber.id} barber={barber} onPress={() => router.push(`/coiffeur/${barber.id}`)} />
        ))}
      </View>
    </Screen>
  );
}
