import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button } from '../../src/components/Button';
import { Header } from '../../src/components/Header';
import { Input } from '../../src/components/Input';
import { Screen } from '../../src/components/Screen';
import { StateMessage } from '../../src/components/StateView';
import { Text } from '../../src/components/Text';
import { getSupabase } from '../../src/data';
import { useAppState } from '../../src/providers/AppState';
import { useTheme } from '../../src/theme';

export default function AuthCallbackScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { repo } = useAppState();
  const url = Linking.useURL();
  const [error, setError] = useState<string | null>(null);
  const [needsPassword, setNeedsPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const parsed = url ? Linking.parse(url) : null;
    const code = typeof parsed?.queryParams?.code === 'string' ? parsed.queryParams.code : '';
    const tokenHash = typeof parsed?.queryParams?.token_hash === 'string' ? parsed.queryParams.token_hash : '';
    const type = typeof parsed?.queryParams?.type === 'string' ? parsed.queryParams.type : '';
    const invite = type === 'invite';
    let cancelled = false;
    void repo
      .completeMagicLink(code, tokenHash ? { tokenHash, type } : undefined)
      .then(() => {
        if (cancelled) {
          return;
        }
        if (invite) {
          setNeedsPassword(true);
          return;
        }
        router.replace('/');
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : 'Lien invalide.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [repo, router, url]);

  async function savePassword() {
    if (password.length < 12) {
      setError('Le mot de passe doit contenir au moins 12 caractères.');
      return;
    }
    const supabase = getSupabase();
    if (!supabase) {
      setError('Projet hébergé requis.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    router.replace('/');
  }

  return (
    <Screen>
      <Header title="Connexion" />
      <View style={{ padding: theme.space[4], gap: theme.space[4] }}>
        {error && !needsPassword ? (
          <StateMessage title="Lien inutilisable" body={error} actionLabel="Retour" onAction={() => router.replace('/connexion')} />
        ) : needsPassword ? (
          <>
            <Text variant="heading-lg">Choisis un mot de passe</Text>
            <Text variant="body-md" color={theme.color.text.secondary}>
              Ton invitation est acceptée. Au moins 12 caractères, puis tu entres dans l’app.
            </Text>
            <Input label="Mot de passe" value={password} onChangeText={setPassword} secureTextEntry error={error ?? undefined} />
            <Button label={busy ? 'Enregistrement' : 'Enregistrer'} onPress={() => void savePassword()} />
          </>
        ) : (
          <StateMessage title="Connexion en cours" body="On vérifie le lien." />
        )}
      </View>
    </Screen>
  );
}
