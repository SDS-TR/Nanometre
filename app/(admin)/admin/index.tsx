import { useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { BoutonDeconnexion } from '../../../src/components/BoutonDeconnexion';
import { Header } from '../../../src/components/Header';
import { LigneHoraire } from '../../../src/components/LigneHoraire';
import { Screen } from '../../../src/components/Screen';
import { SegmentedControl } from '../../../src/components/SegmentedControl';
import { SelecteurDate } from '../../../src/components/SelecteurDate';
import { StatCard } from '../../../src/components/StatCard';
import { StateMessage, LoadingBlock } from '../../../src/components/StateView';
import { Text } from '../../../src/components/Text';
import { formatCad, formatTime, zonedParts } from '../../../src/domain';
import { useAsync } from '../../../src/hooks/useAsync';
import { useAppState } from '../../../src/providers/AppState';
import { useTheme } from '../../../src/theme';

const DEMO = '2026-10-03';

export default function TableauScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const wide = width >= 834;
  const { user } = useAppState();
  const owner = user?.role === 'proprietaire';
  const [date, setDate] = useState(DEMO);
  const [period, setPeriod] = useState<'jour' | 'semaine' | 'mois'>('jour');
  const board = useAsync(
    (repo) => (owner ? repo.getDashboard({ anchor: date, period }) : repo.getDay(date)),
    [owner, date, period],
  );
  const agenda = useAsync((repo) => repo.getAgenda({ date }), [date, user?.id]);
  const percent = (value: number) => `${Math.round(value * 100)} %`;

  return (
    <Screen>
      <Header title={owner ? 'Tableau' : 'Ma journée'} />
      <View style={{ padding: theme.space[4], gap: theme.space[4] }}>
        <Text variant="body-sm" color={theme.color.text.secondary}>
          {owner
            ? 'Revenus hors taxes, calculés sur les rendez-vous chargés dans cette session.'
            : 'Ta chaise seulement. Les montants restent chez le propriétaire.'}
        </Text>
        <SelecteurDate date={date} onChange={setDate} onToday={() => setDate(zonedParts(new Date()).isoDate)} />
        {owner ? (
          <SegmentedControl
            value={period}
            onChange={setPeriod}
            options={[
              { value: 'jour', label: 'Jour' },
              { value: 'semaine', label: 'Semaine' },
              { value: 'mois', label: 'Mois' },
            ]}
          />
        ) : null}
        {board.status === 'loading' && !board.data ? <LoadingBlock /> : null}
        {board.status === 'error' ? <StateMessage title={board.error === 'Accès refusé' ? 'Accès refusé' : 'Impossible de charger'} body={board.error ?? ''} /> : null}
        {board.data ? (
          <View style={{ flexDirection: wide ? 'row' : 'column', gap: theme.space[4] }}>
            <View style={{ flex: 1, gap: theme.space[3] }}>
              {board.data.revenueHtCents != null ? (
                <View style={{ gap: theme.space[1] }}>
                  <Text variant="overline" color={theme.color.text.muted}>
                    Revenu HT
                  </Text>
                  <Text variant="display-lg">{formatCad(board.data.revenueHtCents)}</Text>
                  <Text variant="body-sm" color={theme.color.text.secondary}>
                    {`TTC ${formatCad(board.data.revenueTtcCents ?? 0)} · ${board.data.from} → ${board.data.to}`}
                  </Text>
                </View>
              ) : (
                <Text variant="heading-md">{`${board.data.cuts} coupes`}</Text>
              )}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[3] }}>
                <StatCard label="Coupes" value={String(board.data.cuts)} hint={`${board.data.booked} rendez-vous`} />
                <StatCard label="Annulations" value={String(board.data.cancelled)} />
                <StatCard label="Occupation" value={percent(board.data.occupancy)} hint="Sur 10 h par chaise" />
              </View>
            </View>
            <View style={{ flex: 1, gap: theme.space[3] }}>
              {board.data.perBarber.map((barber) => (
                <View key={barber.name} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.space[3] }}>
                  <Text variant="label-md" style={{ flex: 1 }}>
                    {barber.name}
                  </Text>
                  <Text variant="body-sm" color={theme.color.text.secondary}>
                    {`${barber.cuts} · ${percent(barber.occupancy)}`}
                    {barber.revenueHtCents != null ? ` · ${formatCad(barber.revenueHtCents)}` : ''}
                  </Text>
                </View>
              ))}
              {board.data.topServices.slice(0, 4).map((service) => (
                <Text key={service.name} variant="body-sm" color={theme.color.text.secondary}>
                  {`${service.name} · ${service.count}`}
                  {service.revenueHtCents != null ? ` · ${formatCad(service.revenueHtCents)}` : ''}
                </Text>
              ))}
            </View>
          </View>
        ) : null}
        <Text variant="heading-sm">À l’agenda</Text>
        {agenda.data && agenda.data.filter((entry) => entry.kind === 'booking').length === 0 ? (
          <Text variant="body-sm" color={theme.color.text.muted}>
            Rien à cette date.
          </Text>
        ) : null}
        {agenda.data
          ?.filter((entry) => entry.kind === 'booking')
          .slice(0, 8)
          .map((entry) => (
            <LigneHoraire
              key={entry.id}
              time={formatTime(entry.startMinute)}
              title={entry.title}
              subtitle={`${entry.subtitle}${entry.priceLabel ? ` · ${entry.priceLabel}` : ''}`}
            />
          ))}
        <BoutonDeconnexion />
      </View>
    </Screen>
  );
}
