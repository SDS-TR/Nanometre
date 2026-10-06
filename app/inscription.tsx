import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button } from '../src/components/Button';
import { Header } from '../src/components/Header';
import { Input } from '../src/components/Input';
import { Screen } from '../src/components/Screen';
import { Text } from '../src/components/Text';
import { useAppState } from '../src/providers/AppState';
import { useTheme } from '../src/theme';

export default function InscriptionScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { repo } = useAppState();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setLoading(true);
    setError(null);
    try {
      await repo.signUp({ fullName, email, password });
      router.replace('/');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Inscription impossible.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Screen>
      <Header back title="Inscription" />
      <View style={{ padding: theme.space[4], gap: theme.space[4] }}>
        <Text variant="heading-lg">Créer un compte</Text>
        <Text variant="body-md" color={theme.color.text.secondary}>
          Un compte client suffit pour réserver. L’espace équipe se reçoit par invitation.
        </Text>
        <Input label="Nom" value={fullName} onChangeText={setFullName} autoCapitalize="words" autoComplete="name" textContentType="name" returnKeyType="next" />
        <Input label="Courriel" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoComplete="email" textContentType="emailAddress" returnKeyType="next" />
        <Input label="Mot de passe" value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoComplete="new-password" textContentType="newPassword" returnKeyType="go" onSubmitEditing={() => void submit()} error={error ?? undefined} />
        <Text variant="caption" color={theme.color.text.muted}>
          {repo.mode === 'supabase' ? 'Au moins 12 caractères.' : 'Au moins 8 caractères en mode démo.'}
        </Text>
        <Button label="Créer mon compte" size="lg" fullWidth loading={loading} onPress={submit} />
      </View>
    </Screen>
  );
}
