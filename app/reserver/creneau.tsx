import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button } from '../../src/components/Button';
import { Header } from '../../src/components/Header';
import { ProgressSteps } from '../../src/components/ProgressSteps';
import { Screen } from '../../src/components/Screen';
import { SelecteurDeCreneaux } from '../../src/components/SelecteurDeCreneaux';
import { LoadingBlock, StateMessage } from '../../src/components/StateView';
import { Text } from '../../src/components/Text';
import type { SlotView } from '../../src/data/types';
import { dayHoursLabel, isOpenWeekday, salonDayHours, upcomingDates, weekdayOfIso } from '../../src/domain';
import { useAsync } from '../../src/hooks/useAsync';
import { useDraft } from '../../src/providers/BookingDraft';
import { useTheme } from '../../src/theme';

export default function CreneauScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { draft, update } = useDraft();
  // Horaires du salon : seuls les jours ouverts par le propriétaire sont proposés.
  const salon = useAsync((repo) => repo.getSalon(), []);
  const week = salon.data?.week;
  const dates = useMemo(() => upcomingDates(new Date(), 12, (weekday) => isOpenWeekday(weekday, week)), [week]);
  const [picked, setPicked] = useState<string | undefined>(draft.date);
  const date = picked && dates.includes(picked) ? picked : dates[0];
  const setDate = setPicked;
  const hours = date ? salonDayHours(weekdayOfIso(date), week) : null;
  const [period, setPeriod] = useState<'tout' | 'matin' | 'apres-midi'>('tout');
  const serviceId = draft.serviceId;
  const barberId = draft.barberId ?? 'any';
  const query = useAsync(
    (repo) => {
      if (!serviceId || !date) {
        return Promise.resolve([] as SlotView[]);
      }
      return repo.getSlots({ serviceId, barberId, date });
    },
    [serviceId, barberId, date],
  );
  const selected = query.data?.find((slot) => slot.startMinute === draft.startMinute && slot.available) ?? null;
  return (
    <Screen
      footer={
        <Button
          label="Continuer"
          size="lg"
          fullWidth
          disabled={!selected}
          onPress={() => {
            if (!selected) {
              return;
            }
            update({
              date,
              startMinute: selected.startMinute,
              endMinute: selected.endMinute,
              assignedBarberId: selected.barberId ?? undefined,
              bookingId: undefined,
            });
            router.push('/reserver/recap');
          }}
        />
      }
    >
      <Header back title="Créneau" />
      <View style={{ paddingHorizontal: theme.space[4], paddingBottom: theme.space[3], gap: theme.space[3] }}>
        <ProgressSteps step={3} total={5} />
        <Text variant="heading-lg">Quand ?</Text>
        <Text variant="body-sm" color={theme.color.text.secondary}>
          {date && hours ? `Ouvert ce jour-là, ${dayHoursLabel(hours.openMinute, hours.closeMinute)}. Les créneaux déjà pris ne s’affichent pas.` : ''}
        </Text>
      </View>
      {!serviceId || !draft.barberId ? (
        <StateMessage title="Parcours incomplet" body="Reviens choisir la prestation et le coiffeur." actionLabel="Recommencer" onAction={() => router.replace('/reserver/prestation')} />
      ) : query.status === 'error' ? (
        <StateMessage title="Créneaux indisponibles" body={query.error ?? ''} actionLabel="Réessayer" onAction={query.reload} />
      ) : query.status === 'loading' ? (
        <LoadingBlock />
      ) : (
        <SelecteurDeCreneaux
          dates={dates}
          date={date}
          onDate={(next) => {
            setDate(next);
            update({ startMinute: undefined });
          }}
          period={period}
          onPeriod={setPeriod}
          slots={query.data ?? []}
          selectedStart={draft.date === date ? (draft.startMinute ?? null) : null}
          onSelect={(slot) => update({ date, startMinute: slot.startMinute, endMinute: slot.endMinute, assignedBarberId: slot.barberId ?? undefined })}
          closeMinute={hours?.closeMinute ?? salon.data?.closeMinute}
        />
      )}
    </Screen>
  );
}
