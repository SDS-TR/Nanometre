import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Avatar } from '../../../../src/components/Avatar';
import { Badge } from '../../../../src/components/Badge';
import { Button } from '../../../../src/components/Button';
import { Chip } from '../../../../src/components/Chip';
import { useToast } from '../../../../src/components/Toast';
import { Header } from '../../../../src/components/Header';
import { Screen } from '../../../../src/components/Screen';
import { LoadingBlock, StateMessage } from '../../../../src/components/StateView';
import { Text } from '../../../../src/components/Text';
import type { ManagedBarber } from '../../../../src/data/types';
import { friendlyError, upcomingBarberMessage, WEEKDAY_CHIPS } from '../../../../src/domain';
import { useAsync } from '../../../../src/hooks/useAsync';
import { useAppState } from '../../../../src/providers/AppState';
import { useTheme } from '../../../../src/theme';


/** F-3 : jamais de message brut de la base dans un toast. */
function message(reason: unknown, fallback: string): string {
  return friendlyError(reason, fallback);
}

export default function CoiffeursScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user, repo } = useAppState();
  const toast = useToast();
  const barbers = useAsync((repository) => repository.listManagedBarbers(), [user?.id]);
  const services = useAsync((repository) => repository.listManagedServices(), [user?.id]);
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ id: string; text: string; tone: 'warning' | 'error' } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (user?.role !== 'proprietaire') {
    return (
      <Screen>
        <Header back title="Coiffeurs" />
        <StateMessage title="Accès refusé" body="Seul le propriétaire gère les chaises." />
      </Screen>
    );
  }

  const reload = () => {
    barbers.reload();
    services.reload();
  };
  const activeServices = (services.data ?? []).filter((service) => service.active);
  const working = (barbers.data ?? []).filter((barber) => barber.active);
  const archived = (barbers.data ?? []).filter((barber) => !barber.active);

  const run = (key: string, action: () => Promise<unknown>, success: string, failure: string) => {
    setBusy(key);
    action()
      .then(() => {
        toast({ message: success, tone: 'success' });
        reload();
      })
      .catch((reason: unknown) => {
        toast({ message: message(reason, failure), tone: 'error' });
        reload();
      })
      .finally(() => setBusy(null));
  };

  const askArchive = (barber: ManagedBarber) => {
    const key = `retirer:${barber.id}`;
    if (barber.upcomingCount > 0) {
      setPending(null);
      setNotice({ id: barber.id, text: upcomingBarberMessage(barber.fullName, barber.upcomingCount), tone: 'error' });
      return;
    }
    if (pending !== key) {
      setPending(key);
      setNotice({
        id: barber.id,
        tone: 'warning',
        text:
          barber.accountCount > 0
            ? `Appuie encore pour retirer ${barber.shortName}. Les clients ne le verront plus et son compte sera désactivé. Son historique est gardé.`
            : `Appuie encore pour retirer ${barber.shortName}. Les clients ne le verront plus. Son historique est gardé.`,
      });
      return;
    }
    setPending(null);
    setNotice(null);
    setBusy(key);
    repo
      .archiveBarber(barber.id)
      .then((result) => {
        toast({
          message: result.deactivatedAccounts > 0 ? `${barber.shortName} est retiré. Son compte est désactivé.` : `${barber.shortName} est retiré.`,
          tone: 'success',
        });
        reload();
      })
      .catch((reason: unknown) => {
        setNotice({ id: barber.id, text: message(reason, 'Retrait impossible.'), tone: 'error' });
        reload();
      })
      .finally(() => setBusy(null));
  };

  return (
    <Screen
      footer={
        <Button
          label="Ajouter un coiffeur"
          size="lg"
          fullWidth
          accessibilityLabel="Ajouter un coiffeur à l’équipe"
          onPress={() => router.push('/admin/gestion/nouveau-coiffeur')}
        />
      }
    >
      <Header back title="Coiffeurs" />
      <View style={{ padding: theme.space[4], gap: theme.space[5] }}>
        <Text variant="body-sm" color={theme.color.text.secondary}>
          Retirer un coiffeur le cache des réservations sans rien effacer : ses rendez-vous passés, paiements et avis restent à son nom.
        </Text>
        {barbers.status === 'loading' && !barbers.data ? <LoadingBlock /> : null}
        {barbers.status === 'error' ? (
          <StateMessage title="Chargement impossible" body={barbers.error ?? ''} actionLabel="Réessayer" onAction={reload} />
        ) : null}
        {working.map((barber) => {
          const days = new Set(barber.weekdays);
          const offered = new Set(barber.serviceIds);
          const retireKey = `retirer:${barber.id}`;
          return (
            <View
              key={barber.id}
              style={{ gap: theme.space[3], paddingBottom: theme.space[4], borderBottomWidth: 1, borderBottomColor: theme.color.border.default }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
                <Avatar name={barber.fullName} photo={barber.photo} />
                <View style={{ flex: 1, gap: theme.space[1] }}>
                  <Text variant="heading-sm">{barber.fullName}</Text>
                  <Text variant="caption" color={theme.color.text.muted}>
                    {barber.specialty}
                  </Text>
                </View>
                {barber.upcomingCount > 0 ? (
                  <Badge label={`${barber.upcomingCount} à venir`} tone="info" />
                ) : null}
              </View>
              <Text variant="caption" color={theme.color.text.muted}>
                Jours de travail
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
                {WEEKDAY_CHIPS.map((day) => (
                  <Chip
                    key={day.weekday}
                    label={day.label}
                    selected={days.has(day.weekday)}
                    disabled={busy !== null}
                    onPress={() =>
                      run(
                        `jour:${barber.id}`,
                        () => repo.setBarberWeekday({ barberId: barber.id, weekday: day.weekday, open: !days.has(day.weekday) }),
                        days.has(day.weekday) ? `${barber.shortName} ne travaille plus le ${day.long}.` : `${barber.shortName} travaille le ${day.long}.`,
                        'Jour refusé.',
                      )
                    }
                  />
                ))}
              </View>
              <Text variant="caption" color={theme.color.text.muted}>
                Prestations
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
                {activeServices.map((service) => (
                  <Chip
                    key={service.id}
                    label={service.name}
                    selected={offered.has(service.id)}
                    disabled={busy !== null}
                    onPress={() =>
                      run(
                        `service:${barber.id}`,
                        () => repo.setBarberService({ barberId: barber.id, serviceId: service.id, eligible: !offered.has(service.id) }),
                        offered.has(service.id) ? `${service.name} retiré.` : `${service.name} ajouté.`,
                        'Changement refusé.',
                      )
                    }
                  />
                ))}
              </View>
              {notice?.id === barber.id ? (
                <Text
                  variant="body-sm"
                  accessibilityLiveRegion="polite"
                  color={notice.tone === 'error' ? theme.color.error.default : theme.color.warning.default}
                >
                  {notice.text}
                </Text>
              ) : null}
              <Button
                label={pending === retireKey ? 'Confirmer le retrait' : 'Retirer ce coiffeur'}
                variant={pending === retireKey ? 'destructive' : 'secondary'}
                size="sm"
                loading={busy === retireKey}
                disabled={busy !== null && busy !== retireKey}
                accessibilityLabel={pending === retireKey ? `Confirmer le retrait de ${barber.fullName}` : `Retirer ${barber.fullName}`}
                onPress={() => askArchive(barber)}
              />
            </View>
          );
        })}
        {archived.length > 0 ? (
          <View style={{ gap: theme.space[3] }}>
            <Text variant="heading-sm">Retirés</Text>
            <Text variant="body-sm" color={theme.color.text.secondary}>
              Invisibles pour les clients. Leur historique reste consultable. Après une réactivation, réactive aussi le compte dans Équipe au besoin.
            </Text>
            {archived.map((barber) => {
              const key = `reactiver:${barber.id}`;
              const offered = new Set(barber.serviceIds);
              // F-2 : une chaise réactivée doit offrir au moins une prestation active.
              const needsService = !activeServices.some((service) => offered.has(service.id));
              return (
                <View key={barber.id} style={{ gap: theme.space[2] }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
                    <Avatar name={barber.fullName} photo={barber.photo} size="sm" />
                    <View style={{ flex: 1, gap: theme.space[1] }}>
                      <Text variant="label-md">{barber.fullName}</Text>
                      <Badge label="Retiré" tone="neutral" />
                    </View>
                    <Button
                      label="Réactiver"
                      variant="secondary"
                      size="sm"
                      loading={busy === key}
                      disabled={needsService || (busy !== null && busy !== key)}
                      accessibilityLabel={`Réactiver ${barber.fullName}`}
                      onPress={() => run(key, () => repo.reactivateBarber(barber.id), `${barber.shortName} est de retour à l’horaire.`, 'Réactivation impossible.')}
                    />
                  </View>
                  {needsService ? (
                    <>
                      <Text variant="body-sm" color={theme.color.text.secondary}>
                        {`${barber.shortName} n’offre plus aucune prestation active. Choisis-lui au moins une prestation pour le réactiver.`}
                      </Text>
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
                        {activeServices.map((service) => (
                          <Chip
                            key={service.id}
                            label={service.name}
                            selected={false}
                            disabled={busy !== null}
                            onPress={() =>
                              run(
                                `service:${barber.id}`,
                                () => repo.setBarberService({ barberId: barber.id, serviceId: service.id, eligible: true }),
                                `${service.name} ajouté à ${barber.shortName}.`,
                                'Changement refusé.',
                              )
                            }
                          />
                        ))}
                      </View>
                    </>
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
