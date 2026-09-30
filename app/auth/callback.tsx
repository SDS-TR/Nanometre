import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Header } from '../../src/components/Header';
import { Screen } from '../../src/components/Screen';
import { StateMessage } from '../../src/components/StateView';
import { useAppState } from '../../src/providers/AppState';

export default function AuthCallbackScreen() {
  const router = useRouter();
  const { repo } = useAppState();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    repo
      .completeMagicLink('')
      .then(() => router.replace('/'))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Lien invalide.'));
  }, [repo, router]);

  return (
    <Screen>
      <Header title="Connexion" />
      <View>
        {error ? (
          <StateMessage title="Lien inutilisable" body={error} actionLabel="Retour" onAction={() => router.replace('/connexion')} />
        ) : (
          <StateMessage title="Connexion en cours" body="On vérifie le lien." />
        )}
      </View>
    </Screen>
  );
}
