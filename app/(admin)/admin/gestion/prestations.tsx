import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Badge } from '../../../../src/components/Badge';
import { Button } from '../../../../src/components/Button';
import { Chip } from '../../../../src/components/Chip';
import { Header } from '../../../../src/components/Header';
import { Input } from '../../../../src/components/Input';
import { Screen } from '../../../../src/components/Screen';
import { LoadingBlock, StateMessage } from '../../../../src/components/StateView';
import { Text } from '../../../../src/components/Text';
import type { ManagedService, PriceHistoryEntry } from '../../../../src/data/types';
import {
  formatCad,
  formatDuration,
  friendlyError,
  formatLongDate,
  priceDraftState,
  priceDropNeedsConfirm,
  upcomingServiceMessage,
  zonedParts,
} from '../../../../src/domain';
import { useAsync } from '../../../../src/hooks/useAsync';
import { useToast } from '../../../../src/components/Toast';
import { useAppState } from '../../../../src/providers/AppState';
import { useTheme } from '../../../../src/theme';

/** N-3 : seuls les messages connus du serveur passent, jamais un message brut. */
function message(reason: unknown, fallback: string): string {
  return friendlyError(reason, fallback);
}

function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export default function PrestationsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user, repo } = useAppState();
  const services = useAsync((repository) => repository.listManagedServices(), [user?.id]);
  const barbers = useAsync((repository) => repository.listManagedBarbers(), [user?.id]);
  const toast = useToast();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [history, setHistory] = useState<Record<string, PriceHistoryEntry[] | 'loading' | 'error'>>({});
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; text: string; tone: 'warning' | 'error' } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [revivers, setRevivers] = useState<Record<string, string[]>>({});
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
  const activeBarbers = (barbers.data ?? []).filter((barber) => barber.active);
  const activeBarberIds = new Set(activeBarbers.map((barber) => barber.id));

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
        {active.map((service) => {
          const removing = pendingRemove === service.id;
          const price = priceDraftState(drafts[service.id], service.priceCents);
          const fieldError = price.error ?? errors[service.id];
          const setFieldError = (text: string | null) =>
            setErrors((current) => {
              const next = { ...current };
              if (text) {
                next[service.id] = text;
              } else {
                delete next[service.id];
              }
              return next;
            });
          const rows = history[service.id];
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
                error={fieldError ?? undefined}
                onChangeText={(value) => {
                  setConfirmId(null);
                  setFieldError(null);
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
                  // Actif seulement si le prix change et qu’il est valide.
                  disabled={busy !== null || !price.changed || price.cents === null}
                  accessibilityLabel={price.changed ? `Enregistrer le prix de ${service.name}` : `Enregistrer le prix de ${service.name}, inchangé`}
                  onPress={() => {
                    const cents = price.cents;
                    if (cents === null) {
                      return;
                    }
                    if (priceDropNeedsConfirm(service.priceCents, cents) && confirmId !== service.id) {
                      setConfirmId(service.id);
                      setFieldError(null);
                      return;
                    }
                    setFieldError(null);
                    setConfirmId(null);
                    void repo.updateService({ serviceId: service.id, priceCents: cents }).then(
                      () => {
                        toast({ message: `Prix de « ${service.name} » enregistré : ${formatCad(cents)}.`, tone: 'success' });
                        setDrafts((current) => {
                          const next = { ...current };
                          delete next[service.id];
                          return next;
                        });
                        setHistory((current) => {
                          const next = { ...current };
                          delete next[service.id];
                          return next;
                        });
                        services.reload();
                      },
                      (reason: unknown) => setFieldError(message(reason, 'Tarif refusé.')),
                    );
                  }}
                />
                <Button
                  label="Modifier"
                  variant="secondary"
                  size="sm"
                  disabled={busy !== null}
                  accessibilityLabel={`Modifier le nom, la durée ou la description de ${service.name}`}
                  onPress={() => router.push({ pathname: '/admin/gestion/modifier-prestation', params: { id: service.id } })}
                />
                <Button
                  label={rows && rows !== 'error' ? 'Masquer l’historique' : 'Historique des prix'}
                  variant="ghost"
                  size="sm"
                  accessibilityLabel={`Historique des prix de ${service.name}`}
                  onPress={() => {
                    if (rows && rows !== 'error') {
                      setHistory((current) => {
                        const next = { ...current };
                        delete next[service.id];
                        return next;
                      });
                      return;
                    }
                    setHistory((current) => ({ ...current, [service.id]: 'loading' }));
                    repo
                      .listPriceHistory(service.id)
                      .then((entries) => setHistory((current) => ({ ...current, [service.id]: entries })))
                      .catch(() => setHistory((current) => ({ ...current, [service.id]: 'error' })));
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
              {rows === 'loading' ? <LoadingBlock /> : null}
              {rows === 'error' ? (
                <Text variant="body-sm" color={theme.color.error.default}>
                  Historique indisponible.
                </Text>
              ) : null}
              {Array.isArray(rows) ? (
                <View style={{ gap: theme.space[1] }} accessibilityLabel={`Historique des prix de ${service.name}`}>
                  {rows.length === 0 ? (
                    <Text variant="body-sm" color={theme.color.text.secondary}>
                      Aucun changement de prix enregistré.
                    </Text>
                  ) : (
                    rows.map((entry) => (
                      <Text key={entry.id} variant="body-sm" color={theme.color.text.secondary}>
                        {`${formatLongDate(zonedParts(new Date(entry.at)).isoDate)} : ${formatCad(entry.oldCents)} → ${formatCad(entry.newCents)}`}
                      </Text>
                    ))
                  )}
                </View>
              ) : null}
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
              // N-4 : une prestation revient seulement si un coiffeur actif la fait.
              const offeredByActive = service.barberIds.some((id) => activeBarberIds.has(id));
              const chosen = (revivers[service.id] ?? []).filter((id) => activeBarberIds.has(id));
              const barbersKnown = barbers.data !== null;
              const needsBarber = barbersKnown && !offeredByActive;
              // Sans la liste des coiffeurs, le serveur tranche et répond en français.
              const canReactivate = barbersKnown ? offeredByActive || chosen.length > 0 : barbers.status === 'error';
              return (
                <View key={service.id} style={{ gap: theme.space[2] }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
                    <View style={{ flex: 1, gap: theme.space[1] }}>
                      <Text variant="label-md">{`${service.name} · ${formatCad(service.priceCents)}`}</Text>
                      <Badge label="Retirée" tone="neutral" />
                    </View>
                    <Button
                      label="Réactiver"
                      variant="secondary"
                      size="sm"
                      loading={busy === key}
                      disabled={!canReactivate || (busy !== null && busy !== key)}
                      accessibilityLabel={
                        canReactivate ? `Réactiver ${service.name}` : `Réactiver ${service.name}, choisis d’abord au moins un coiffeur`
                      }
                      onPress={() => {
                        setBusy(key);
                        repo
                          .reactivateService(service.id, needsBarber ? chosen : [])
                          .then(() => {
                            toast({ message: `« ${service.name} » est de retour au catalogue.`, tone: 'success' });
                            setRevivers((current) => ({ ...current, [service.id]: [] }));
                            services.reload();
                          })
                          .catch((reason: unknown) => toast({ message: message(reason, 'Réactivation impossible.'), tone: 'error' }))
                          .finally(() => setBusy(null));
                      }}
                    />
                  </View>
                  {needsBarber ? (
                    <View style={{ gap: theme.space[2] }}>
                      <Text variant="body-sm" color={theme.color.text.secondary} accessibilityLiveRegion="polite">
                        {activeBarbers.length === 0
                          ? 'Aucun coiffeur actif. Réactive d’abord un coiffeur dans Coiffeurs.'
                          : 'Aucun coiffeur actif ne fait cette prestation. Choisis qui la fera, puis réactive-la.'}
                      </Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
                        {activeBarbers.map((barber) => (
                          <Chip
                            key={barber.id}
                            label={barber.shortName}
                            selected={chosen.includes(barber.id)}
                            disabled={busy !== null}
                            onPress={() => setRevivers((current) => ({ ...current, [service.id]: toggle(current[service.id] ?? [], barber.id) }))}
                          />
                        ))}
                      </View>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
