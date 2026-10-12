import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Avatar } from '../../../../src/components/Avatar';
import { Button } from '../../../../src/components/Button';
import { Chip } from '../../../../src/components/Chip';
import { Header } from '../../../../src/components/Header';
import { Input } from '../../../../src/components/Input';
import { Screen } from '../../../../src/components/Screen';
import { LoadingBlock, StateMessage } from '../../../../src/components/StateView';
import { Text } from '../../../../src/components/Text';
import { useToast } from '../../../../src/components/Toast';
import { friendlyError, suggestShortName, validateNewBarber, WEEKDAY_CHIPS } from '../../../../src/domain';
import { useAsync } from '../../../../src/hooks/useAsync';
import { useAppState } from '../../../../src/providers/AppState';
import { useTheme } from '../../../../src/theme';

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export default function NouveauCoiffeurScreen() {
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const { user, repo } = useAppState();
  const services = useAsync((repository) => repository.listManagedServices(), [user?.id]);
  const [fullName, setFullName] = useState('');
  const [shortName, setShortName] = useState('');
  const [shortEdited, setShortEdited] = useState(false);
  const [specialty, setSpecialty] = useState('');
  const [weekdays, setWeekdays] = useState<number[]>(WEEKDAY_CHIPS.map((day) => day.weekday));
  const [serviceIds, setServiceIds] = useState<string[] | null>(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const active = (services.data ?? []).filter((service) => service.active);
  if (user?.role !== 'proprietaire') {
    return (
      <Screen>
        <Header back title="Nouveau coiffeur" />
        <StateMessage title="Accès refusé" body="Seul le propriétaire ajoute un coiffeur." />
      </Screen>
    );
  }

  // Toutes les prestations actives par défaut, tant que le propriétaire n’a rien touché.
  const chosen = serviceIds ?? active.map((service) => service.id);
  const submit = async () => {
    setError(null);
    setEmailError(null);
    const trimmedEmail = email.trim();
    if (trimmedEmail && !EMAIL.test(trimmedEmail)) {
      setEmailError('Courriel invalide. Laisse vide pour inviter plus tard.');
      return;
    }
    const input = { fullName, shortName, specialty, weekdays, serviceIds: chosen };
    try {
      validateNewBarber(input, new Set(active.map((service) => service.id)));
    } catch (reason) {
      setError(friendlyError(reason, 'Formulaire incomplet.'));
      return;
    }
    setSaving(true);
    let created: { id: string };
    try {
      created = await repo.createBarber(input);
    } catch (reason) {
      setSaving(false);
      setError(friendlyError(reason, 'Ajout impossible.'));
      return;
    }
    const display = shortName.trim();
    if (trimmedEmail) {
      try {
        await repo.inviteMember({ fullName: fullName.trim(), email: trimmedEmail, role: 'coiffeur', barberId: created.id });
        toast({
          message: repo.mode === 'local' ? `${display} est ajouté, avec son compte.` : `${display} est ajouté. Invitation envoyée à ${trimmedEmail}.`,
          tone: 'success',
        });
      } catch (reason) {
        const why = friendlyError(reason, 'Invitation impossible.');
        toast({ message: `${display} est ajouté, mais l’invitation a échoué : ${why} Tu peux la renvoyer dans Équipe.`, tone: 'error' });
      }
    } else {
      toast({ message: `${display} est ajouté. Les clients peuvent le réserver.`, tone: 'success' });
    }
    setSaving(false);
    router.back();
  };

  return (
    <Screen
      footer={
        <Button
          label="Ajouter le coiffeur"
          size="lg"
          fullWidth
          loading={saving}
          disabled={saving || services.status !== 'ready'}
          onPress={() => void submit()}
        />
      }
    >
      <Header back title="Nouveau coiffeur" />
      <View style={{ padding: theme.space[4], gap: theme.space[4] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
          <Avatar name={fullName.trim() || '?'} size="lg" />
          <Text variant="body-sm" color={theme.color.text.secondary} style={{ flex: 1 }}>
            Ses initiales servent d’avatar dans l’app.
          </Text>
        </View>
        <Input
          label="Nom complet"
          value={fullName}
          onChangeText={(value) => {
            setFullName(value);
            if (!shortEdited) {
              setShortName(suggestShortName(value));
            }
          }}
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
          returnKeyType="next"
        />
        <Input
          label="Prénom affiché aux clients"
          value={shortName}
          onChangeText={(value) => {
            setShortEdited(true);
            setShortName(value);
          }}
          autoCapitalize="words"
        />
        <Input label="Spécialité (facultatif)" value={specialty} onChangeText={setSpecialty} placeholder="Ex. : dégradés, barbe" autoCapitalize="sentences" />

        <Text variant="heading-sm">Jours de travail</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          {WEEKDAY_CHIPS.map((day) => (
            <Chip key={day.weekday} label={day.label} selected={weekdays.includes(day.weekday)} onPress={() => setWeekdays((current) => toggle(current, day.weekday))} />
          ))}
        </View>

        <Text variant="heading-sm">Prestations offertes</Text>
        {services.status === 'loading' ? <LoadingBlock /> : null}
        {services.status === 'error' ? <Text variant="body-sm" color={theme.color.error.default}>{services.error}</Text> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          {active.map((service) => (
            <Chip
              key={service.id}
              label={service.name}
              selected={chosen.includes(service.id)}
              onPress={() => setServiceIds(toggle(chosen, service.id))}
            />
          ))}
        </View>

        <Text variant="heading-sm">Compte de connexion (facultatif)</Text>
        <Text variant="body-sm" color={theme.color.text.secondary}>
          {repo.mode === 'local'
            ? 'En démo, le compte est créé tout de suite avec le mot de passe nanometre.'
            : 'Il reçoit une invitation par courriel. Son compte s’active à la première connexion.'}
        </Text>
        <Input
          label="Courriel du coiffeur"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          error={emailError ?? undefined}
        />
        {error ? (
          <Text variant="body-sm" color={theme.color.error.default} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}
