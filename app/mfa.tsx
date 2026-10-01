import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button } from '../src/components/Button';
import { Header } from '../src/components/Header';
import { Input } from '../src/components/Input';
import { Screen } from '../src/components/Screen';
import { StateMessage } from '../src/components/StateView';
import { Text } from '../src/components/Text';
import { getSupabase } from '../src/data';
import { useAppState } from '../src/providers/AppState';
import { useTheme } from '../src/theme';

export default function MfaScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user, repo } = useAppState();
  const [secret, setSecret] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!user || user.role !== 'proprietaire') {
    return (
      <Screen>
        <Header back title="Vérification" />
        <StateMessage title="Accès refusé" body="La vérification en deux étapes est exigée pour le propriétaire." />
      </Screen>
    );
  }

  if (repo.mode !== 'supabase') {
    return (
      <Screen>
        <Header back title="Vérification" />
        <StateMessage
          title="Projet hébergé"
          body="Le mode démo n’a pas d’application d’authentification. Sur Supabase, le propriétaire enrôle un TOTP avant les remboursements, l’équipe et les réglages."
          actionLabel="Retour"
          onAction={() => router.back()}
        />
      </Screen>
    );
  }

  async function enroll() {
    const supabase = getSupabase();
    if (!supabase) {
      return;
    }
    setError(null);
    const { data, error: enrollError } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Le Nanomètre' });
    if (enrollError || !data) {
      setError(enrollError?.message ?? 'Enrôlement impossible.');
      return;
    }
    setFactorId(data.id);
    setSecret(data.totp.secret);
  }

  async function verify() {
    const supabase = getSupabase();
    if (!supabase || !factorId || !/^\d{6}$/.test(code.trim())) {
      setError('Entre le code à 6 chiffres.');
      return;
    }
    setError(null);
    const challenge = await supabase.auth.mfa.challenge({ factorId });
    if (challenge.error || !challenge.data) {
      setError(challenge.error?.message ?? 'Défi impossible.');
      return;
    }
    const verified = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code: code.trim() });
    if (verified.error) {
      setError('Code refusé.');
      return;
    }
    setDone(true);
  }

  return (
    <Screen>
      <Header back title="Vérification" />
      <View style={{ padding: theme.space[4], gap: theme.space[4] }}>
        <Text variant="heading-lg">Deux étapes</Text>
        <Text variant="body-md" color={theme.color.text.secondary}>
          Ajoute Le Nanomètre dans ton application d’authentification. Les actions sensibles exigent ensuite ce code.
        </Text>
        {done ? (
          <Text variant="body-md">C’est en place. Tes prochaines actions d’argent et d’équipe demanderont le code.</Text>
        ) : (
          <>
            <Button label="Afficher la clé" onPress={() => void enroll()} />
            {secret ? (
              <Text variant="body-sm" color={theme.color.text.secondary}>
                {`Clé : ${secret}`}
              </Text>
            ) : null}
            <Input label="Code à 6 chiffres" value={code} onChangeText={setCode} keyboardType="number-pad" error={error ?? undefined} />
            <Button label="Confirmer" onPress={() => void verify()} />
          </>
        )}
      </View>
    </Screen>
  );
}
