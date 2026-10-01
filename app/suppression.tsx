import { useState } from 'react';
import { Linking, View } from 'react-native';
import { Button } from '../src/components/Button';
import { Header } from '../src/components/Header';
import { Input } from '../src/components/Input';
import { Screen } from '../src/components/Screen';
import { Text } from '../src/components/Text';
import { getRepository } from '../src/data';
import { useTheme } from '../src/theme';

const MAIL = 'karim@lenanometre.ca';

export default function SuppressionScreen() {
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setMessage(null);
    const repo = getRepository();
    try {
      if (repo.mode === 'supabase') {
        await repo.requestAccountDeletion(email);
      }
      const href = `mailto:${MAIL}?subject=${encodeURIComponent('Suppression de compte')}&body=${encodeURIComponent(`Courriel du compte : ${email.trim()}`)}`;
      await Linking.openURL(href);
      setMessage('La demande est notée. Un courriel s’ouvre aussi vers le salon, sans réinstaller l’application.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Demande impossible.');
    }
  }

  return (
    <Screen>
      <Header title="Suppression du compte" />
      <View style={{ padding: theme.space[4], gap: theme.space[4] }}>
        <Text variant="heading-lg">Fermer ton compte</Text>
        <Text variant="body-md" color={theme.color.text.secondary}>
          Tu peux demander la suppression depuis cette page, sans réinstaller l’application. Indique le courriel du compte. Les reçus exigés par la loi fiscale restent six ans, sans ton nom. Les notes du salon sont retirées après 24 mois.
        </Text>
        <Input label="Courriel du compte" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" error={error ?? undefined} />
        <Button label="Demander la suppression" onPress={() => void submit()} />
        {message ? (
          <Text variant="body-sm" color={theme.color.text.secondary}>
            {message}
          </Text>
        ) : null}
        <Text variant="caption" color={theme.color.text.muted}>
          {`Ou écris à ${MAIL}. Dans l’app, Profil permet aussi de confirmer tout de suite, mot de passe à l’appui si la session n’est plus récente.`}
        </Text>
      </View>
    </Screen>
  );
}
