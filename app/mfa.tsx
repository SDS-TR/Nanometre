import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
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

type Step = 'loading' | 'enroll' | 'challenge' | 'done';

export default function MfaScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user, repo } = useAppState();
  const [step, setStep] = useState<Step>('loading');
  const [secret, setSecret] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || user.role !== 'proprietaire' || repo.mode !== 'supabase') {
      return;
    }
    const supabase = getSupabase();
    if (!supabase) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const level = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (cancelled) {
        return;
      }
      if (level.data?.currentLevel === 'aal2') {
        setStep('done');
        return;
      }
      const factors = await supabase.auth.mfa.listFactors();
      if (cancelled) {
        return;
      }
      const existing = factors.data?.totp?.[0];
      if (level.data?.nextLevel === 'aal2' && existing) {
        setFactorId(existing.id);
        setStep('challenge');
        return;
      }
      setStep('enroll');
    })();
    return () => {
      cancelled = true;
    };
  }, [repo.mode, user]);

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
          body="Le mode démo n’a pas d’application d’authentification. Sur Supabase, le propriétaire enrôle un TOTP, puis chaque session suivante redemande le code."
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
    setQr(data.totp.qr_code);
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
    await supabase.auth.refreshSession();
    setStep('done');
  }

  return (
    <Screen>
      <Header back title="Vérification" />
      <View style={{ padding: theme.space[4], gap: theme.space[4] }}>
        <Text variant="heading-lg">Deux étapes</Text>
        {step === 'loading' ? <Text variant="body-md">On vérifie ta session.</Text> : null}
        {step === 'done' ? (
          <>
            <Text variant="body-md">La session est au niveau renforcé. L’espace propriétaire est ouvert.</Text>
            <Button label="Continuer" onPress={() => router.replace('/admin')} />
          </>
        ) : null}
        {step === 'challenge' ? (
          <>
            <Text variant="body-md" color={theme.color.text.secondary}>
              Entre le code de ton application d’authentification pour cette session.
            </Text>
            <Input label="Code à 6 chiffres" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" error={error ?? undefined} />
            <Button label="Confirmer" onPress={() => void verify()} />
          </>
        ) : null}
        {step === 'enroll' ? (
          <>
            <Text variant="body-md" color={theme.color.text.secondary}>
              Ajoute Le Nanomètre dans ton application d’authentification. Les actions sensibles et l’espace propriétaire exigent ensuite ce code.
            </Text>
            <Button label="Afficher le code" onPress={() => void enroll()} />
            {qr ? (
              <Text variant="body-sm" color={theme.color.text.secondary}>
                Scanne le code dans ton application, ou saisis la clé.
              </Text>
            ) : null}
            {secret ? (
              <Text variant="body-sm" color={theme.color.text.secondary}>
                {`Clé : ${secret}`}
              </Text>
            ) : null}
            <Input label="Code à 6 chiffres" value={code} onChangeText={setCode} keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" error={error ?? undefined} />
            <Button label="Confirmer" onPress={() => void verify()} />
          </>
        ) : null}
      </View>
    </Screen>
  );
}
