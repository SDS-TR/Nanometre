import { useRouter } from 'expo-router';
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
import { formatCad, formatDuration, parsePriceCents, SERVICE_DURATIONS, validateNewService } from '../../../../src/domain';
import { useAsync } from '../../../../src/hooks/useAsync';
import { useAppState } from '../../../../src/providers/AppState';
import { useTheme } from '../../../../src/theme';

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export default function NouvellePrestationScreen() {
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const { user, repo } = useAppState();
  const catalogue = useAsync(
    async (repository) => {
      const [barbers, services] = await Promise.all([repository.listManagedBarbers(), repository.listManagedServices()]);
      return { barbers: barbers.filter((barber) => barber.active), names: services.filter((service) => service.active).map((service) => service.name) };
    },
    [user?.id],
  );
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState<number>(30);
  const [price, setPrice] = useState('');
  const [priceError, setPriceError] = useState<string | null>(null);
  const [barberIds, setBarberIds] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (user?.role !== 'proprietaire') {
    return (
      <Screen>
        <Header back title="Nouvelle prestation" />
        <StateMessage title="Accès refusé" body="Seul le propriétaire ajoute une prestation." />
      </Screen>
    );
  }

  // Tous les coiffeurs actifs par défaut, tant que le propriétaire n’a rien touché.
  const chosen = barberIds ?? catalogue.data?.barbers.map((barber) => barber.id) ?? [];
  let preview: string | null = null;
  try {
    preview = price.trim() ? formatCad(parsePriceCents(price)) : null;
  } catch {
    preview = null;
  }

  const submit = async () => {
    setError(null);
    setPriceError(null);
    let cents: number;
    try {
      cents = parsePriceCents(price);
    } catch {
      setPriceError('Tarif invalide. Exemple : 35,00');
      return;
    }
    const input = { name, description, durationMinutes: duration, priceCents: cents, barberIds: chosen };
    try {
      validateNewService(input, new Set(catalogue.data?.barbers.map((barber) => barber.id) ?? []), catalogue.data?.names ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Formulaire incomplet.');
      return;
    }
    setSaving(true);
    try {
      await repo.createService(input);
      toast({ message: `« ${name.trim()} » est ajoutée au catalogue.`, tone: 'success' });
      router.back();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Ajout impossible.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      footer={
        <Button
          label="Ajouter la prestation"
          size="lg"
          fullWidth
          loading={saving}
          disabled={saving || catalogue.status !== 'ready'}
          onPress={() => void submit()}
        />
      }
    >
      <Header back title="Nouvelle prestation" />
      <View style={{ padding: theme.space[4], gap: theme.space[4] }}>
        <Input label="Nom" value={name} onChangeText={setName} placeholder="Ex. : Coupe et coiffage" autoCapitalize="sentences" returnKeyType="next" />
        <Input label="Description (facultatif)" value={description} onChangeText={setDescription} autoCapitalize="sentences" />

        <Text variant="heading-sm">Durée</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          {SERVICE_DURATIONS.map((minutes) => (
            <Chip key={minutes} label={formatDuration(minutes)} selected={duration === minutes} onPress={() => setDuration(minutes)} />
          ))}
        </View>

        <Input
          label="Prix HT, en dollars"
          value={price}
          onChangeText={(value) => {
            setPriceError(null);
            setPrice(value);
          }}
          placeholder="35,00"
          keyboardType="default"
          error={priceError ?? undefined}
        />
        {preview ? (
          <Text variant="caption" color={theme.color.text.muted}>
            {`${preview} avant taxes. La TPS et la TVQ s’ajoutent au paiement.`}
          </Text>
        ) : null}

        <Text variant="heading-sm">Coiffeurs qui la font</Text>
        {catalogue.status === 'loading' ? <LoadingBlock /> : null}
        {catalogue.status === 'error' ? <Text variant="body-sm" color={theme.color.error.default}>{catalogue.error}</Text> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          {catalogue.data?.barbers.map((barber) => (
            <Chip
              key={barber.id}
              label={barber.shortName}
              selected={chosen.includes(barber.id)}
              onPress={() => setBarberIds(toggle(chosen, barber.id))}
            />
          ))}
        </View>
        {error ? (
          <Text variant="body-sm" color={theme.color.error.default} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}
