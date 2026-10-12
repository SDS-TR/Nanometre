import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button } from '../../../../src/components/Button';
import { Header } from '../../../../src/components/Header';
import { Screen } from '../../../../src/components/Screen';
import { SegmentedControl } from '../../../../src/components/SegmentedControl';
import { LoadingBlock, StateMessage } from '../../../../src/components/StateView';
import { Text } from '../../../../src/components/Text';
import { friendlyError, salonWeekSummary } from '../../../../src/domain';
import { useAsync } from '../../../../src/hooks/useAsync';
import { useAppState } from '../../../../src/providers/AppState';
import { useTheme } from '../../../../src/theme';
import type { Salon } from '../../../../src/data/types';

export default function SalonScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user, repo } = useAppState();
  const salon = useAsync((repository) => repository.getSalon(), [user?.id]);
  const [policy, setPolicy] = useState<Salon['onsiteLatePolicy'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  if (user?.role !== 'proprietaire') {
    return (
      <Screen>
        <Header back title="Salon" />
        <StateMessage title="Accès refusé" body="Les réglages du salon sont réservés au propriétaire." />
      </Screen>
    );
  }
  // Les heures se règlent jour par jour dans « Horaires du salon » ; on renvoie celles en place.
  const openMinute = salon.data?.openMinute ?? 540;
  const closeMinute = salon.data?.closeMinute ?? 1140;
  const currentPolicy = policy ?? salon.data?.onsiteLatePolicy ?? 'aucun';
  return (
    <Screen>
      <Header back title="Salon" />
      <View style={{ padding: theme.space[4], gap: theme.space[4] }}>
        {salon.status === 'loading' && !salon.data ? <LoadingBlock /> : null}
        <Text variant="label-sm">Horaires</Text>
        {salonWeekSummary(salon.data?.week).map((line) => (
          <Text key={line} variant="body-md">
            {line}
          </Text>
        ))}
        <Button label="Modifier les horaires" variant="secondary" onPress={() => router.push('/admin/gestion/horaires')} />
        <Text variant="label-sm">Annulation tardive sur place</Text>
        <SegmentedControl<Salon['onsiteLatePolicy']>
          value={currentPolicy}
          onChange={setPolicy}
          options={[
            { value: 'aucun', label: 'Aucun frais' },
            { value: 'a_la_prochaine', label: 'Dû à la prochaine' },
          ]}
        />
        <Text variant="body-sm" color={theme.color.text.secondary}>
          Par défaut, une annulation à moins de 24 h payée sur place ne retient rien. L’autre réglage note le montant dû à la visite suivante, sans encaissement immédiat.
        </Text>
        {error ? (
          <Text variant="body-sm" color={theme.color.error.default} accessibilityRole="alert" accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        {saved ? (
          <Text variant="body-sm" color={theme.color.success.default} accessibilityRole="alert" accessibilityLiveRegion="polite">
            Réglages enregistrés.
          </Text>
        ) : null}
        <Button
          label="Enregistrer"
          onPress={() => {
            const force = true;
            setSaved(false);
            setError(null);
            void repo
              .updateSalonSettings({ openMinute, closeMinute, onsiteLatePolicy: currentPolicy, force })
              .then(() => setSaved(true))
              .catch((reason: unknown) => setError(friendlyError(reason, 'Réglage refusé.')));
          }}
        />
      </View>
    </Screen>
  );
}
