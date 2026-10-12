import { useState } from 'react';
import { Switch, View } from 'react-native';
import { Button } from '../../../../src/components/Button';
import { Header } from '../../../../src/components/Header';
import { Input } from '../../../../src/components/Input';
import { Screen } from '../../../../src/components/Screen';
import { LoadingBlock, StateMessage } from '../../../../src/components/StateView';
import { Text } from '../../../../src/components/Text';
import { useToast } from '../../../../src/components/Toast';
import {
  clockInput,
  dayHoursLabel,
  defaultSalonWeek,
  friendlyError,
  parseClock,
  SALON_HOURS_MESSAGES,
  WEEK_ORDER,
  weekdayLong,
  type SalonDay,
} from '../../../../src/domain';
import { useAsync } from '../../../../src/hooks/useAsync';
import { useAppState } from '../../../../src/providers/AppState';
import { useTheme } from '../../../../src/theme';

type Draft = { weekday: number; open: boolean; openText: string; closeText: string };

function toDrafts(week: readonly SalonDay[]): Draft[] {
  return WEEK_ORDER.map((weekday) => {
    const day = week.find((item) => item.weekday === weekday) ?? { weekday, open: true, openMinute: 0, closeMinute: 1440 };
    return { weekday, open: day.open, openText: clockInput(day.openMinute), closeText: clockInput(day.closeMinute) };
  });
}

/** Erreur d’un jour, ou ses minutes. Un jour fermé garde ses heures pour la réouverture. */
function readDay(draft: Draft): { day: SalonDay; error: null } | { day: null; error: string } {
  let openMinute: number;
  let closeMinute: number;
  try {
    openMinute = parseClock(draft.openText);
    closeMinute = parseClock(draft.closeText);
  } catch {
    if (!draft.open) {
      return { day: { weekday: draft.weekday, open: false, openMinute: 0, closeMinute: 1440 }, error: null };
    }
    return { day: null, error: 'Heure invalide. Exemple : 09:00, par quarts d’heure.' };
  }
  if (draft.open && closeMinute <= openMinute) {
    return { day: null, error: SALON_HOURS_MESSAGES.order };
  }
  if (!draft.open && closeMinute <= openMinute) {
    return { day: { weekday: draft.weekday, open: false, openMinute: 0, closeMinute: 1440 }, error: null };
  }
  return { day: { weekday: draft.weekday, open: draft.open, openMinute, closeMinute }, error: null };
}

export default function HorairesScreen() {
  const theme = useTheme();
  const toast = useToast();
  const { user, repo } = useAppState();
  const salon = useAsync((repository) => repository.getSalon(), [user?.id]);
  const [edited, setDrafts] = useState<Draft[] | null>(null);
  const drafts = edited ?? (salon.data ? toDrafts(salon.data.week ?? defaultSalonWeek()) : null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (user?.role !== 'proprietaire') {
    return (
      <Screen>
        <Header back title="Horaires du salon" />
        <StateMessage title="Accès refusé" body="Les horaires du salon sont réservés au propriétaire." />
      </Screen>
    );
  }
  const rows = drafts ?? [];
  const parsed = rows.map(readDay);
  const hasDayError = parsed.some((item) => item.error);
  const noDay = rows.length > 0 && rows.every((row) => !row.open);
  const conflict = Boolean(error?.includes('sortent'));
  const update = (weekday: number, patch: Partial<Draft>) => {
    setError(null);
    setDrafts((current) => (current ?? drafts ?? []).map((row) => (row.weekday === weekday ? { ...row, ...patch } : row)));
  };
  const save = () => {
    if (hasDayError || noDay) {
      return;
    }
    const week = parsed.map((item) => item.day as SalonDay);
    setBusy(true);
    setError(null);
    void repo
      .setSalonHours({ week, force: conflict })
      .then((next) => {
        setDrafts(toDrafts(next.week ?? week));
        toast({ message: 'Horaires enregistrés.', tone: 'success' });
      })
      .catch((reason: unknown) => setError(friendlyError(reason, 'Réglage refusé.')))
      .finally(() => setBusy(false));
  };
  const footer = (
    <View style={{ gap: theme.space[2] }}>
      {error || noDay ? (
        <Text variant="body-sm" color={theme.color.error.default} accessibilityRole="alert" accessibilityLiveRegion="polite">
          {error ?? SALON_HOURS_MESSAGES.noDay}
        </Text>
      ) : null}
      <Button
        label={conflict ? 'Enregistrer quand même' : 'Enregistrer'}
        onPress={save}
        disabled={busy || hasDayError || noDay || !drafts}
        loading={busy}
      />
    </View>
  );
  return (
    <Screen footer={footer}>
      <Header back title="Horaires du salon" />
      <View style={{ padding: theme.space[4], gap: theme.space[4] }}>
        {salon.status === 'loading' && !salon.data ? <LoadingBlock /> : null}
        <Text variant="body-md" color={theme.color.text.secondary}>
          Les clients voient les créneaux où le salon est ouvert et où le coiffeur travaille. Un jour fermé n’offre aucun créneau.
        </Text>
        {rows.map((row, index) => {
          const name = weekdayLong(row.weekday);
          const label = name.charAt(0).toUpperCase() + name.slice(1);
          const day = parsed[index];
          return (
            <View
              key={row.weekday}
              style={{
                gap: theme.space[2],
                padding: theme.space[3],
                borderRadius: theme.radius.md,
                borderWidth: 1,
                borderColor: day.error ? theme.color.error.default : theme.color.border.default,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View style={{ flex: 1 }}>
                  <Text variant="label-md">{label}</Text>
                  <Text variant="caption" color={theme.color.text.secondary}>
                    {row.open ? (day.day ? dayHoursLabel(day.day.openMinute, day.day.closeMinute) : 'À corriger') : 'Fermé'}
                  </Text>
                </View>
                <Switch
                  accessibilityLabel={`${label} : ${row.open ? 'ouvert' : 'fermé'}`}
                  value={row.open}
                  onValueChange={(open) => update(row.weekday, { open })}
                />
              </View>
              {row.open ? (
                <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
                  <View style={{ flex: 1 }}>
                    <Input label={`Ouverture ${name}`} value={row.openText} onChangeText={(openText) => update(row.weekday, { openText })} placeholder="09:00" keyboardType="default" autoCapitalize="none" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Input label={`Fermeture ${name}`} value={row.closeText} onChangeText={(closeText) => update(row.weekday, { closeText })} placeholder="19:00" keyboardType="default" autoCapitalize="none" />
                  </View>
                </View>
              ) : null}
              {row.open && day.error ? (
                <Text variant="caption" color={theme.color.error.default} accessibilityLiveRegion="polite">
                  {day.error}
                </Text>
              ) : null}
            </View>
          );
        })}
        <Text variant="caption" color={theme.color.text.secondary}>
          Par quarts d’heure. 00:00 à 24:00 = toute la journée.
        </Text>
      </View>
    </Screen>
  );
}
