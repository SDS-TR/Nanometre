import { useState } from 'react';
import { View } from 'react-native';
import { Button } from '../../../../src/components/Button';
import { Header } from '../../../../src/components/Header';
import { Screen } from '../../../../src/components/Screen';
import { SegmentedControl } from '../../../../src/components/SegmentedControl';
import { LoadingBlock, StateMessage } from '../../../../src/components/StateView';
import { Text } from '../../../../src/components/Text';
import { formatTime, friendlyError, OPEN_WEEKDAYS, openDaysPhrase } from '../../../../src/domain';
import { useAsync } from '../../../../src/hooks/useAsync';
import { useAppState } from '../../../../src/providers/AppState';
import { useTheme } from '../../../../src/theme';
import type { Salon } from '../../../../src/data/types';

export default function SalonScreen() {
  const theme = useTheme();
  const { user, repo } = useAppState();
  const salon = useAsync((repository) => repository.getSalon(), [user?.id]);
  const [open, setOpen] = useState<number | null>(null);
  const [close, setClose] = useState<number | null>(null);
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
  const openMinute = open ?? salon.data?.openMinute ?? 540;
  const closeMinute = close ?? salon.data?.closeMinute ?? 1140;
  const currentPolicy = policy ?? salon.data?.onsiteLatePolicy ?? 'aucun';
  return (
    <Screen>
      <Header back title="Salon" />
      <View style={{ padding: theme.space[4], gap: theme.space[4] }}>
        {salon.status === 'loading' && !salon.data ? <LoadingBlock /> : null}
        <Text variant="body-md">
          {`Ouvert de ${formatTime(openMinute)} à ${formatTime(closeMinute)}, ${openDaysPhrase([...OPEN_WEEKDAYS]).toLowerCase()}.`}
        </Text>
        <Text variant="label-sm">Ouverture</Text>
        <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
          {[8, 9, 10].map((hour) => (
            <Button key={hour} label={formatTime(hour * 60)} size="sm" variant={openMinute === hour * 60 ? 'primary' : 'secondary'} onPress={() => setOpen(hour * 60)} />
          ))}
        </View>
        <Text variant="label-sm">Fermeture</Text>
        <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
          {[18, 19, 20].map((hour) => (
            <Button key={hour} label={formatTime(hour * 60)} size="sm" variant={closeMinute === hour * 60 ? 'primary' : 'secondary'} onPress={() => setClose(hour * 60)} />
          ))}
        </View>
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
        {error ? <Text variant="body-sm" color={theme.color.error.default}>{error}</Text> : null}
        {saved ? <Text variant="body-sm" color={theme.color.success.default}>Réglages enregistrés.</Text> : null}
        <Button
          label={error?.includes('sortent') ? 'Enregistrer quand même' : 'Enregistrer'}
          onPress={() => {
            const force = Boolean(error?.includes('sortent'));
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
