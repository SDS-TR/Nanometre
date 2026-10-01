import { useState } from 'react';
import { View } from 'react-native';
import { Button } from '../../../../src/components/Button';
import { Header } from '../../../../src/components/Header';
import { Input } from '../../../../src/components/Input';
import { Screen } from '../../../../src/components/Screen';
import { StateMessage } from '../../../../src/components/StateView';
import { Text } from '../../../../src/components/Text';
import { formatCad, formatDuration } from '../../../../src/domain';
import { useAsync } from '../../../../src/hooks/useAsync';
import { useAppState } from '../../../../src/providers/AppState';
import { useTheme } from '../../../../src/theme';

export default function PrestationsScreen() {
  const theme = useTheme();
  const { user, repo } = useAppState();
  const services = useAsync((repository) => repository.getServices(), []);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  if (user?.role !== 'proprietaire') {
    return (
      <Screen>
        <Header back title="Prestations" />
        <StateMessage title="Accès refusé" body="Les prix sont cachés pour un coiffeur." />
      </Screen>
    );
  }
  return (
    <Screen>
      <Header back title="Prestations" />
      <View style={{ padding: theme.space[4], gap: theme.space[4] }}>
        {error ? <Text variant="body-sm" color={theme.color.error.default}>{error}</Text> : null}
        {services.data?.map((service) => (
          <View key={service.id} style={{ gap: theme.space[2] }}>
            <Text variant="label-md">{`${service.name} · ${formatDuration(service.durationMinutes)} · ${formatCad(service.priceCents)}`}</Text>
            <Input
              label="Nouveau prix HT, en dollars"
              value={drafts[service.id] ?? ''}
              onChangeText={(value) => setDrafts((current) => ({ ...current, [service.id]: value }))}
              placeholder="55,00"
              keyboardType="default"
            />
            <Button
              label="Enregistrer"
              size="sm"
              onPress={() => {
                const raw = (drafts[service.id] ?? '').replace(',', '.').replace(/[^\d.]/g, '');
                const cents = Math.round(Number(raw) * 100);
                if (!Number.isFinite(cents) || cents < 0) {
                  setError('Tarif invalide.');
                  return;
                }
                setError(null);
                void repo.updateService({ serviceId: service.id, priceCents: cents }).catch((reason: unknown) => {
                  setError(reason instanceof Error ? reason.message : 'Tarif refusé.');
                });
              }}
            />
          </View>
        ))}
      </View>
    </Screen>
  );
}
