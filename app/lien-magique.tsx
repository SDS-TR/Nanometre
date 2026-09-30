import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button } from '../src/components/Button';
import { Header } from '../src/components/Header';
import { Input } from '../src/components/Input';
import { Screen } from '../src/components/Screen';
import { Text } from '../src/components/Text';
import { useAppState } from '../src/providers/AppState';
import { useTheme } from '../src/theme';

export default function LienMagiqueScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const { repo } = useAppState();
  const [email, setEmail] = useState(params.email ?? '');
  const [sent, setSent] = useState(false);
  const [demo, setDemo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function send() {
    setLoading(true);
    setError(null);
    try {
      const result = await repo.sendMagicLink(email);
      setDemo(result.demo);
      setSent(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Envoi impossible.');
    } finally {
      setLoading(false);
    }
  }

  async function openDemo() {
    setLoading(true);
    try {
      await repo.completeMagicLink(email);
      router.replace('/');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Lien invalide.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <Header back title="Lien magique" />
      <View style={{ padding: theme.space[4], gap: theme.space[4] }}>
        <Text variant="heading-lg">Sans mot de passe</Text>
        <Text variant="body-md" color={theme.color.text.secondary}>
          On t’envoie un lien de connexion. Aucun mot de passe à retenir. Les clés d’accès viendront plus tard.
        </Text>
        <Input label="Courriel" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" error={error ?? undefined} />
        <Button label="Envoyer le lien" size="lg" fullWidth loading={loading && !sent} onPress={send} />
        {sent ? (
          <Text variant="body-sm" color={theme.color.text.secondary}>
            {demo
              ? 'Mode démo : aucun courriel n’est parti. Ouvre le lien ci-dessous pour entrer.'
              : 'Consulte tes courriels et ouvre le lien pour terminer la connexion.'}
          </Text>
        ) : null}
        {sent && demo ? <Button label="Ouvrir le lien de démo" variant="secondary" loading={loading} onPress={openDemo} /> : null}
      </View>
    </Screen>
  );
}
