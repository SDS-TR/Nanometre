import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button } from '../../../../src/components/Button';
import { Chip } from '../../../../src/components/Chip';
import { Header } from '../../../../src/components/Header';
import { Input } from '../../../../src/components/Input';
import { Screen } from '../../../../src/components/Screen';
import { LoadingBlock, StateMessage } from '../../../../src/components/StateView';
import { Text } from '../../../../src/components/Text';
import { useToast } from '../../../../src/components/Toast';
import { formatDuration, friendlyError, parseDurationMinutes, SERVICE_DURATIONS, validateServiceDetails } from '../../../../src/domain';
import { useAsync } from '../../../../src/hooks/useAsync';
import { useAppState } from '../../../../src/providers/AppState';
import { useTheme } from '../../../../src/theme';

export default function ModifierPrestationScreen() {
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { user, repo } = useAppState();
  const services = useAsync((repository) => repository.listManagedServices(), [user?.id]);
  const service = services.data?.find((item) => item.id === id) ?? null;
  const [name, setName] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [customDraft, setCustom] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Durée hors des puces : on la montre dans « Autre durée » tant que rien n’est touché.
  const custom =
    customDraft ??
    (service && duration === null && !(SERVICE_DURATIONS as readonly number[]).includes(service.durationMinutes) ? String(service.durationMinutes) : '');

  if (user?.role !== 'proprietaire') {
    return (
      <Screen>
        <Header back title="Modifier la prestation" />
        <StateMessage title="Accès refusé" body="Seul le propriétaire modifie une prestation." />
      </Screen>
    );
  }
  if (services.status === 'loading' && !services.data) {
    return (
      <Screen>
        <Header back title="Modifier la prestation" />
        <LoadingBlock />
      </Screen>
    );
  }
  if (!service) {
    return (
      <Screen>
        <Header back title="Modifier la prestation" />
        <StateMessage title="Prestation introuvable" body="Elle a peut-être été retirée." actionLabel="Retour aux prestations" onAction={() => router.dismissTo('/admin/gestion/prestations')} />
      </Screen>
    );
  }
  const currentName = name ?? service.name;
  const currentDescription = description ?? service.description ?? '';
  const currentDuration = duration ?? service.durationMinutes;

  const submit = async () => {
    setError(null);
    let minutes = currentDuration;
    if (custom.trim()) {
      try {
        minutes = parseDurationMinutes(custom);
      } catch (reason) {
        setError(friendlyError(reason, 'Durée invalide.'));
        return;
      }
    }
    const others = (services.data ?? []).filter((item) => item.active && item.id !== service.id).map((item) => item.name);
    let clean: ReturnType<typeof validateServiceDetails>;
    try {
      clean = validateServiceDetails({ name: currentName, description: currentDescription, durationMinutes: minutes }, others);
    } catch (reason) {
      setError(friendlyError(reason, 'Formulaire incomplet.'));
      return;
    }
    setSaving(true);
    try {
      await repo.updateServiceDetails({ serviceId: service.id, ...clean });
      toast({ message: `« ${clean.name} » est à jour.`, tone: 'success' });
      router.dismissTo('/admin/gestion/prestations');
    } catch (reason) {
      setError(friendlyError(reason, 'Modification impossible.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      footer={
        <View style={{ gap: theme.space[2] }}>
          {error ? (
            <Text variant="body-sm" color={theme.color.error.default} accessibilityRole="alert" accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <Button label="Enregistrer les changements" size="lg" fullWidth loading={saving} disabled={saving} onPress={() => void submit()} />
        </View>
      }
    >
      <Header back title="Modifier la prestation" />
      <View style={{ padding: theme.space[4], gap: theme.space[4] }}>
        <Input label="Nom" value={currentName} onChangeText={setName} autoCapitalize="sentences" />
        <Input label="Description (facultatif)" value={currentDescription} onChangeText={setDescription} autoCapitalize="sentences" />
        <Text variant="heading-sm">Durée</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          {SERVICE_DURATIONS.map((minutes) => (
            <Chip
              key={minutes}
              label={formatDuration(minutes)}
              selected={!custom.trim() && currentDuration === minutes}
              onPress={() => {
                setCustom('');
                setDuration(minutes);
              }}
            />
          ))}
        </View>
        <Input label="Autre durée, en minutes" value={custom} onChangeText={setCustom} placeholder="50" keyboardType="number-pad" />
        <Text variant="caption" color={theme.color.text.muted}>
          La nouvelle durée vaut pour les prochaines réservations. Les rendez-vous déjà pris gardent leur durée et le prix ne change pas ici.
        </Text>
      </View>
    </Screen>
  );
}
