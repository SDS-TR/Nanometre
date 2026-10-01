import { View } from 'react-native';
import { formatCad, formatLongDate, formatTimeRange } from '../domain';
import { useTheme } from '../theme';
import { Text } from './Text';

type Props = {
  serviceName: string;
  barberName: string;
  date: string;
  startMinute: number;
  endMinute: number;
  paymentLabel: string;
  subtotalCents: number;
  gstCents: number;
  qstCents: number;
  totalCents: number;
  discountCents?: number;
  promoCode?: string | null;
  policyNote?: string;
};

export function RecapReservation(props: Props) {
  const theme = useTheme();
  const rows = [
    ['Prestation', props.serviceName],
    ['Coiffeur', props.barberName],
    ['Date', formatLongDate(props.date)],
    ['Heure', formatTimeRange(props.startMinute, props.endMinute)],
    ['Paiement', props.paymentLabel],
  ] as const;
  return (
    <View style={{ gap: theme.space[4] }}>
      <View style={{ backgroundColor: theme.color.bg.elevated, borderRadius: theme.radius.lg, padding: theme.space[4], gap: theme.space[3] }}>
        {rows.map(([label, value]) => (
          <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.space[3] }}>
            <Text variant="body-sm" color={theme.color.text.muted}>
              {label}
            </Text>
            <Text variant="label-md" style={{ flexShrink: 1, textAlign: 'right' }}>
              {value}
            </Text>
          </View>
        ))}
      </View>
      <View style={{ gap: theme.space[2] }}>
        {props.discountCents ? <TaxRow label={props.promoCode ? `Code ${props.promoCode}` : 'Réduction'} value={`-${formatCad(props.discountCents)}`} /> : null}
        <TaxRow label="Sous-total" value={formatCad(props.subtotalCents)} />
        <TaxRow label="TPS (5 %)" value={formatCad(props.gstCents)} />
        <TaxRow label="TVQ (9,975 %)" value={formatCad(props.qstCents)} />
        <View style={{ height: 1, backgroundColor: theme.color.border.default, marginVertical: theme.space[1] }} />
        <TaxRow label="Total" value={formatCad(props.totalCents)} strong />
      </View>
      <View style={{ backgroundColor: theme.color.info.subtle, borderRadius: theme.radius.md, padding: theme.space[3] }}>
        <Text variant="body-sm" color={theme.color.info.onSubtle}>
          {props.policyNote ??
            'Annulation gratuite jusqu’à 24 h avant. Moins de 24 h : des frais de 50 % du prix avant taxes sont retenus si le rendez-vous est payé en ligne. Sur place, aucun frais par défaut.'}
        </Text>
      </View>
    </View>
  );
}

function TaxRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text variant={strong ? 'label-md' : 'body-sm'} color={strong ? theme.color.text.primary : theme.color.text.secondary}>
        {label}
      </Text>
      <Text variant={strong ? 'heading-sm' : 'body-sm'} color={strong ? theme.color.accent.default : theme.color.text.primary}>
        {value}
      </Text>
    </View>
  );
}
