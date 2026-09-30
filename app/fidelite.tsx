import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { CarteFidelite } from '../src/components/CarteFidelite';
import { Header } from '../src/components/Header';
import { Screen } from '../src/components/Screen';
import { LoadingBlock, StateMessage } from '../src/components/StateView';
import { Text } from '../src/components/Text';
import { useAsync } from '../src/hooks/useAsync';
import { useAppState } from '../src/providers/AppState';
import { useTheme } from '../src/theme';

export default function FideliteScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAppState();
  const query = useAsync((repo) => (user ? repo.getLoyalty() : Promise.resolve(null)), [user?.id]);
  return (
    <Screen>
      <Header back title="Fidélité" />
      <View style={{ padding: theme.space[4], gap: theme.space[4] }}>
        {!user ? (
          <StateMessage title="Connecte-toi" body="La carte est liée à ton compte." actionLabel="Connexion" onAction={() => router.push('/connexion?next=/fidelite')} />
        ) : null}
        {user && query.status === 'loading' ? <LoadingBlock /> : null}
        {user && query.status === 'error' ? (
          <StateMessage title="Carte indisponible" body={query.error ?? ''} actionLabel="Réessayer" onAction={query.reload} />
        ) : null}
        {query.data ? <CarteFidelite loyalty={query.data} /> : null}
        <Text variant="body-sm" color={theme.color.text.secondary}>
          Les points s’ajoutent quand la coupe est honorée, sur le montant avant taxes. Au dixième tampon, la prochaine coupe est offerte — taxes comprises à 0 $.
        </Text>
      </View>
    </Screen>
  );
}
