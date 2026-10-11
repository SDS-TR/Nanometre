import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Badge } from '../../../../src/components/Badge';
import { Button } from '../../../../src/components/Button';
import { Header } from '../../../../src/components/Header';
import { Input } from '../../../../src/components/Input';
import { Screen } from '../../../../src/components/Screen';
import { LoadingBlock, StateMessage } from '../../../../src/components/StateView';
import { Text } from '../../../../src/components/Text';
import type { ManagedService } from '../../../../src/data/types';
import { formatCad, formatDuration, parsePriceCents, priceDropNeedsConfirm, upcomingServiceMessage } from '../../../../src/domain';
import { useAsync } from '../../../../src/hooks/useAsync';
import { useToast } from '../../../../src/components/Toast';
import { useAppState } from '../../../../src/providers/AppState';
import { useTheme } from '../../../../src/theme';

function message(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

export default function PrestationsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user, repo } = useAppState();
  const services = useAsync((repository) => repository.listManagedServices(), [user?.id]);
  const toast = useToast();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; text: string; tone: 'warning' | 'error' } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  if (user?.role !== 'proprietaire') {
    return (
      <Screen>
        <Header back title="Prestations" />
        <StateMessage title="Accès refusé" body="Les prix sont cachés pour un coiffeur." />
      </Screen>
    );
  }
  const active = (services.data ?? []).filter((service) => service.active);
  const archived = (services.data ?? []).filter((service) => !service.active);

  const askArchive = (service: ManagedService) => {
    if (service.upcomingCount > 0) {
      setPendingRemove(null);
      setNotice({ id: service.id, tone: 'error', text: upcomingServiceMessage(service.name, service.upcomingCount) });
      return;
    }
    if (pendingRemove !== service.id) {
      setPendingRemove(service.id);
      setNotice({
        id: service.id,
        tone: 'warning',
        text: `Appuie encore pour retirer « ${service.name} ». Elle disparaît des réservations. Les reçus et l’historique gardent son nom et son prix.`,
      });
      return;
    }
    setPendingRemove(null);
    setNotice(null);
    setBusy(`retirer:${service.id}`);
    repo
      .archiveService(service.id)
      .then(() => {
        toast({ message: `« ${service.name} » est retirée.`, tone: 'success' });
        services.reload();
      })
      .catch((reason: unknown) => {
        setNotice({ id: service.id, tone: 'error', text: message(reason, 'Retrait impossible.') });
        services.reload();
      })
      .finally(() => setBusy(null));
  };

  return (
    <Screen
      footer={
        <Button
          label="Ajouter une prestation"
          size="lg"
          fullWidth
          accessibilityLabel="Ajouter une prestation au catalogue"
          onPress={() => router.push('/admin/gestion/nouvelle-prestation')}
        />
      }
    >
      <Header back title="Prestations" />
      <View style={{ padding: theme.space[4], gap: theme.space[4] }}>
        <Text variant="body-sm" color={theme.color.text.secondary}>
          Retirer une prestation la cache des réservations sans rien effacer. Les codes promo restent valides sur les autres prestations.
        </Text>
        {services.status === 'loading' && !services.data ? <LoadingBlock /> : null}
        {services.status === 'error' ? (
          <StateMessage title="Chargement impossible" body={services.error ?? ''} actionLabel="Réessayer" onAction={services.reload} />
        ) : null}
        {error ? <Text variant="body-sm" color={theme.color.error.default}>{error}</Text> : null}
        {active.map((service) => {
          const removing = pendingRemove === service.id;
          return (
            <View
              key={service.id}
              style={{ gap: theme.space[2], paddingBottom: theme.space[4], borderBottomWidth: 1, borderBottomColor: theme.color.border.default }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
                <Text variant="label-md" style={{ flex: 1 }}>
                  {`${service.name} · ${formatDuration(service.durationMinutes)} · ${formatCad(service.priceCents)}`}
                </Text>
                {service.upcomingCount > 0 ? <Badge label={`${service.upcomingCount} à venir`} tone="info" /> : null}
              </View>
              <Text variant="caption" color={theme.color.text.muted}>
                {service.barberIds.length === 0
                  ? 'Aucun coiffeur ne la fait.'
                  : service.barberIds.length === 1
                    ? '1 coiffeur la fait.'
                    : `${service.barberIds.length} coiffeurs la font.`}
              </Text>
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
              <View style={{ flexDirection: 'row', gap: theme.space[2], flexWrap: 'wrap' }}>
                <Button
                  label={confirmId === service.id ? 'Confirmer le nouveau prix' : 'Enregistrer'}
                  size="sm"
                  disabled={busy !== null}
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
                      () => {
                        toast({ message: 'Prix enregistré.', tone: 'success' });
                        services.reload();
                      },
                      (reason: unknown) => setError(message(reason, 'Tarif refusé.')),
                    );
                  }}
                />
                <Button
                  label={removing ? 'Confirmer le retrait' : 'Retirer'}
                  variant={removing ? 'destructive' : 'secondary'}
                  size="sm"
                  loading={busy === `retirer:${service.id}`}
                  disabled={busy !== null}
                  accessibilityLabel={removing ? `Confirmer le retrait de ${service.name}` : `Retirer ${service.name}`}
                  onPress={() => askArchive(service)}
                />
              </View>
              {notice?.id === service.id ? (
                <Text
                  variant="body-sm"
                  accessibilityLiveRegion="polite"
                  color={notice.tone === 'error' ? theme.color.error.default : theme.color.warning.default}
                >
                  {notice.text}
                </Text>
              ) : null}
            </View>
          );
        })}
        {archived.length > 0 ? (
          <View style={{ gap: theme.space[3] }}>
            <Text variant="heading-sm">Retirées</Text>
            {archived.map((service) => {
              const key = `reactiver:${service.id}`;
              return (
                <View key={service.id} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
                  <View style={{ flex: 1, gap: theme.space[1] }}>
                    <Text variant="label-md">{`${service.name} · ${formatCad(service.priceCents)}`}</Text>
                    <Badge label="Retirée" tone="neutral" />
                  </View>
                  <Button
                    label="Réactiver"
                    variant="secondary"
                    size="sm"
                    loading={busy === key}
                    disabled={busy !== null && busy !== key}
                    accessibilityLabel={`Réactiver ${service.name}`}
                    onPress={() => {
                      setBusy(key);
                      repo
                        .reactivateService(service.id)
                        .then(() => {
                          toast({ message: `« ${service.name} » est de retour au catalogue.`, tone: 'success' });
                          services.reload();
                        })
                        .catch((reason: unknown) => toast({ message: message(reason, 'Réactivation impossible.'), tone: 'error' }))
                        .finally(() => setBusy(null));
                    }}
                  />
                </View>
              );
            })}
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
