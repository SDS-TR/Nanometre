import { useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { BlocRendezVous } from '../../../src/components/BlocRendezVous';
import { BottomSheet } from '../../../src/components/BottomSheet';
import { Button } from '../../../src/components/Button';
import { Chip } from '../../../src/components/Chip';
import { FeuilleBlocage } from '../../../src/components/FeuilleBlocage';
import { Header } from '../../../src/components/Header';
import { Screen } from '../../../src/components/Screen';
import { SelecteurDate } from '../../../src/components/SelecteurDate';
import { LoadingBlock, StateMessage } from '../../../src/components/StateView';
import { Text } from '../../../src/components/Text';
import { formatTime, zonedParts } from '../../../src/domain';
import { useAsync } from '../../../src/hooks/useAsync';
import { useAppState } from '../../../src/providers/AppState';
import { useTheme } from '../../../src/theme';
import type { AgendaEntry } from '../../../src/data/types';

const DEMO = '2026-10-03';

export default function AgendaScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const wide = width >= 834;
  const { user, repo } = useAppState();
  const owner = user?.role === 'proprietaire';
  const [date, setDate] = useState(DEMO);
  const [barberId, setBarberId] = useState<string | null>(owner ? null : user?.barberId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);
  const [moving, setMoving] = useState<AgendaEntry | null>(null);
  const [moveDate, setMoveDate] = useState(DEMO);
  const [moveStart, setMoveStart] = useState<number | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const barbers = useAsync((repository) => repository.getBarbers(), []);
  const salon = useAsync((repository) => repository.getSalon(), []);
  const agenda = useAsync((repository) => repository.getAgenda({ date, barberId }), [date, barberId, user?.id]);
  const moveSlots = useAsync(
    (repository) =>
      moving?.serviceId
        ? repository.getSlots({ barberId: moving.barberId, serviceId: moving.serviceId, date: moveDate })
        : Promise.resolve([]),
    [moving?.id, moving?.barberId, moving?.serviceId, moveDate],
  );

  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Action impossible.');
    } finally {
      setBusy(false);
    }
  }

  const targetBarber = barberId ?? user?.barberId ?? barbers.data?.[0]?.id ?? '';
  const columns = wide ? splitColumns(agenda.data ?? []) : [agenda.data ?? []];

  return (
    <Screen>
      <Header title="Agenda" />
      <View style={{ padding: theme.space[4], gap: theme.space[4] }}>
        {!owner ? (
          <Text variant="body-sm" color={theme.color.text.secondary}>
            Ton agenda. Tu peux bloquer tes heures. Déplacer ou annuler un client, c’est le propriétaire.
          </Text>
        ) : null}
        <SelecteurDate date={date} onChange={setDate} onToday={() => setDate(zonedParts(new Date()).isoDate)} />
        {owner ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
            <Chip label="Tous" selected={barberId == null} onPress={() => setBarberId(null)} />
            {barbers.data?.map((barber) => (
              <Chip key={barber.id} label={barber.shortName} selected={barberId === barber.id} onPress={() => setBarberId(barber.id)} />
            ))}
          </View>
        ) : null}
        <Button label="Bloquer un créneau" variant="secondary" onPress={() => { setBlockError(null); setBlockOpen(true); }} />
        {error ? <Text variant="body-sm" color={theme.color.error.default}>{error}</Text> : null}
        {agenda.status === 'loading' && !agenda.data ? <LoadingBlock /> : null}
        {agenda.status === 'error' ? (
          <StateMessage title={agenda.error === 'Accès refusé' ? 'Accès refusé' : 'Agenda indisponible'} body={agenda.error ?? ''} />
        ) : null}
        <View style={{ flexDirection: wide ? 'row' : 'column', gap: theme.space[3], alignItems: 'flex-start' }}>
          {columns.map((column, index) => (
            <View key={index} style={{ flex: 1, gap: theme.space[3], width: '100%' }}>
              {column.map((entry) => (
                <BlocRendezVous key={entry.id} entry={entry}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
                    {entry.canHonor ? (
                      <Button label="Honorer" size="sm" loading={busy} onPress={() => void run(() => repo.honorBooking(entry.id))} />
                    ) : null}
                    {entry.status === 'confirme' && !entry.canHonor ? (
                      <Text variant="caption" color={theme.color.text.muted}>
                        La visite n’a pas encore commencé.
                      </Text>
                    ) : null}
                    {entry.canMove ? (
                      <Button
                        label="Déplacer"
                        size="sm"
                        variant="secondary"
                        onPress={() => {
                          setMoveError(null);
                          setMoving(entry);
                          setMoveDate(date);
                          setMoveStart(null);
                        }}
                      />
                    ) : null}
                    {entry.canCancel ? (
                      <Button label="Annuler" size="sm" variant="destructive" loading={busy} onPress={() => void run(() => repo.cancelClientBooking(entry.id))} />
                    ) : null}
                    {entry.kind === 'block' ? (
                      <Button label="Débloquer" size="sm" variant="secondary" loading={busy} onPress={() => void run(() => repo.unblockSlot(entry.id))} />
                    ) : null}
                  </View>
                </BlocRendezVous>
              ))}
            </View>
          ))}
        </View>
        {agenda.data?.length === 0 ? (
          <Text variant="body-sm" color={theme.color.text.muted}>
            Journée libre.
          </Text>
        ) : null}
      </View>
      <FeuilleBlocage
        visible={blockOpen}
        openMinute={salon.data?.openMinute ?? 9 * 60}
        closeMinute={salon.data?.closeMinute ?? 19 * 60}
        error={blockError}
        loading={busy}
        onClose={() => setBlockOpen(false)}
        onConfirm={(input) => {
          void run(async () => {
            try {
              await repo.blockSlot({ barberId: targetBarber, date, ...input });
              setBlockOpen(false);
            } catch (reason) {
              setBlockError(reason instanceof Error ? reason.message : 'Blocage impossible.');
              throw reason;
            }
          });
        }}
      />
      <BottomSheet visible={moving != null} onClose={() => setMoving(null)} title="Déplacer le rendez-vous">
        <SelecteurDate
          date={moveDate}
          onChange={(next) => {
            setMoveDate(next);
            setMoveStart(null);
            setMoveError(null);
          }}
          onToday={() => {
            setMoveDate(zonedParts(new Date()).isoDate);
            setMoveStart(null);
          }}
        />
        <Text variant="caption" color={theme.color.text.muted}>
          {moving ? `Actuellement ${formatTime(moving.startMinute)}. ` : ''}
          Choisis un créneau libre. Le client reçoit un avis s’il l’a demandé.
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          {(moveSlots.data ?? [])
            .filter((slot) => slot.available)
            .map((slot) => (
              <Chip
                key={slot.startMinute}
                label={formatTime(slot.startMinute)}
                selected={moveStart === slot.startMinute}
                onPress={() => setMoveStart(slot.startMinute)}
              />
            ))}
        </View>
        {moveSlots.data && moveSlots.data.every((slot) => !slot.available) ? (
          <Text variant="body-sm" color={theme.color.text.secondary}>
            Aucun créneau libre ce jour-là.
          </Text>
        ) : null}
        {moveError ? (
          <Text variant="body-sm" color={theme.color.error.default} accessibilityLiveRegion="polite">
            {moveError}
          </Text>
        ) : null}
        <Button
          label="Enregistrer"
          loading={busy}
          fullWidth
          disabled={moveStart == null}
          onPress={() => {
            if (!moving || moveStart == null) {
              return;
            }
            void run(async () => {
              try {
                await repo.moveBooking({ bookingId: moving.id, date: moveDate, startMinute: moveStart });
                setMoving(null);
              } catch (reason) {
                setMoveError(reason instanceof Error ? reason.message : 'Déplacement impossible.');
              }
            });
          }}
        />
      </BottomSheet>
    </Screen>
  );
}

function splitColumns(entries: AgendaEntry[]): AgendaEntry[][] {
  const left: AgendaEntry[] = [];
  const right: AgendaEntry[] = [];
  entries.forEach((entry, index) => {
    (index % 2 === 0 ? left : right).push(entry);
  });
  return [left, right];
}
