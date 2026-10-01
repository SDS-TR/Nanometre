import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button } from '../src/components/Button';
import { Header } from '../src/components/Header';
import { Input } from '../src/components/Input';
import { Screen } from '../src/components/Screen';
import { Text } from '../src/components/Text';
import { demoLoginPrefill } from '../src/lib/demoAuth';
import { safeNext } from '../src/lib/safeNext';
import { useAppState } from '../src/providers/AppState';
import { useTheme } from '../src/theme';

const demos = [
  ['Alex Gagnon', 'alex.gagnon@exemple.ca'],
  ['Karim, propriétaire', 'karim@lenanometre.ca'],
  ['Julien, coiffeur', 'julien.morel@lenanometre.ca'],
] as const;

export default function ConnexionScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ next?: string }>();
  const { repo } = useAppState();
  const prefill = demoLoginPrefill(repo.mode, typeof __DEV__ === 'undefined' ? false : __DEV__);
  const [email, setEmail] = useState(prefill.email);
  const [password, setPassword] = useState(prefill.password);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      await repo.signIn(email, password);
      router.replace(safeNext(params.next) as '/');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Connexion impossible.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <Header back title="Connexion" />
      <View style={{ padding: theme.space[4], gap: theme.space[4] }}>
        <Text variant="heading-lg">Bon retour</Text>
        <Text variant="body-md" color={theme.color.text.secondary}>
          Entre ton courriel et ton mot de passe. Tu peux aussi recevoir un lien magique.
        </Text>
        <Input label="Courriel" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" error={error ?? undefined} />
        <Input label="Mot de passe" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" />
        <Button label="Se connecter" size="lg" fullWidth loading={loading} onPress={submit} />
        <Button label="Recevoir un lien magique" variant="secondary" onPress={() => router.push({ pathname: '/lien-magique', params: { email } })} />
        <Button label="Créer un compte" variant="ghost" onPress={() => router.push('/inscription')} />
        {repo.mode === 'local' ? (
          <View style={{ gap: theme.space[2] }}>
            <Text variant="caption" color={theme.color.text.muted}>
              Comptes de démonstration · mot de passe nanometre
            </Text>
            {demos.map(([label, value]) => (
              <Button key={value} label={label} variant="ghost" onPress={() => setEmail(value)} />
            ))}
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
