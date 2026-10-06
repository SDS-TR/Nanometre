import { useState } from 'react';
import { View } from 'react-native';
import { Button } from '../../../../src/components/Button';
import { Header } from '../../../../src/components/Header';
import { Input } from '../../../../src/components/Input';
import { Screen } from '../../../../src/components/Screen';
import { StateMessage } from '../../../../src/components/StateView';
import { Text } from '../../../../src/components/Text';
import { formatCad, formatDuration, parsePriceCents, priceDropNeedsConfirm } from '../../../../src/domain';
import { useAsync } from '../../../../src/hooks/useAsync';
import { useToast } from '../../../../src/components/Toast';
import { useAppState } from '../../../../src/providers/AppState';
import { useTheme } from '../../../../src/theme';

export default function PrestationsScreen() {
  const theme = useTheme();
  const { user, repo } = useAppState();
  const services = useAsync((repository) => repository.getServices(), []);
  const toast = useToast();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
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
              label="Prix HT, en dollars"
              value={drafts[service.id] ?? (service.priceCents / 100).toFixed(2).replace('.', ',')}
              onChangeText={(value) => {
                setConfirmId(null);
                setDrafts((current) => ({ ...current, [service.id]: value }));
              }}
              keyboardType="default"
            />
            {confirmId === service.id ? (
              <Text variant="body-sm" color={theme.color.warning.default}>
                Baisse de plus de la moitié. Appuie encore pour confirmer.
              </Text>
            ) : null}
            <Button
              label={confirmId === service.id ? 'Confirmer le nouveau prix' : 'Enregistrer'}
              size="sm"
              onPress={() => {
                let cents = 0;
                try {
                  cents = parsePriceCents(drafts[service.id] ?? (service.priceCents / 100).toFixed(2).replace('.', ','));
                } catch (reason) {
                  setError(reason instanceof Error ? reason.message : 'Tarif invalide.');
                  return;
                }
                if (priceDropNeedsConfirm(service.priceCents, cents) && confirmId !== service.id) {
                  setConfirmId(service.id);
                  setError(null);
                  return;
                }
                setError(null);
                setConfirmId(null);
                void repo.updateService({ serviceId: service.id, priceCents: cents }).then(
                  () => toast({ message: 'Prix enregistré.', tone: 'success' }),
                  (reason: unknown) => setError(reason instanceof Error ? reason.message : 'Tarif refusé.'),
                );
              }}
            />
          </View>
        ))}
      </View>
    </Screen>
  );
}
