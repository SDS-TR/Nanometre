import { View } from 'react-native';
import { formatCad, formatLongDate, formatTimeRange, lateFeeCents, quoteCancellation, zonedDateTime } from '../domain';
import { useTheme } from '../theme';
import type { BookingView } from '../data/types';
import { Badge } from './Badge';
import { Button } from './Button';
import { Text } from './Text';

const labels = {
  confirme: { label: 'Confirmé', tone: 'success' },
  en_attente_paiement: { label: 'Paiement à terminer', tone: 'warning' },
  honore: { label: 'Honoré', tone: 'neutral' },
  annule: { label: 'Annulé', tone: 'neutral' },
  annule_tardif: { label: 'Annulé · frais', tone: 'warning' },
} as const;

export function CarteRendezVous({
  booking,
  onCancel,
  onPay,
}: {
  booking: BookingView;
  onCancel?: () => void;
  onPay?: () => void;
}) {
  const theme = useTheme();
  const badge = booking.paymentStatus === 'a_encaisser' && booking.status === 'confirme'
    ? { label: 'À payer au salon', tone: 'info' as const }
    : labels[booking.status];
  const startsAt = zonedDateTime(booking.date, booking.startMinute);
  const quote = quoteCancellation({
    startsAt,
    now: new Date(),
    preTaxCents: booking.priceCents,
    totalCents: booking.totalCents,
    paymentMethod: booking.paymentMethod,
    paymentStatus: booking.paymentStatus,
    status: booking.status,
  });
  const withinBanner = quote.allowed && quote.within24h && booking.paymentMethod === 'en_ligne';
  return (
    <View
      style={{
        backgroundColor: theme.color.bg.elevated,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.color.border.default,
        padding: theme.space[4],
        gap: theme.space[3],
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.space[2] }}>
        <Text variant="label-md" style={{ flex: 1 }}>
          {formatLongDate(booking.date)}
        </Text>
        <Badge label={badge.label} tone={badge.tone} />
      </View>
      <Text variant="heading-sm">{booking.serviceName}</Text>
      <Text variant="body-sm" color={theme.color.text.secondary}>
        {booking.barberName} · {formatTimeRange(booking.startMinute, booking.startMinute + booking.durationMinutes)}
      </Text>
      <Text variant="label-md" color={theme.color.accent.default}>
        {formatCad(booking.totalCents)}
      </Text>
      {withinBanner ? (
        <View style={{ backgroundColor: theme.color.warning.subtle, borderRadius: theme.radius.md, padding: theme.space[3] }}>
          <Text variant="body-sm" color={theme.color.warning.onSubtle}>
            Annulation à moins de 24 h : frais de 50 % du prix avant taxes, soit {formatCad(lateFeeCents(booking.priceCents))} (payé en ligne).
          </Text>
        </View>
      ) : null}
      {booking.feeCents > 0 ? (
        <Text variant="caption" color={theme.color.text.muted}>
          Frais d’annulation tardive {formatCad(booking.feeCents)} (TPS {formatCad(booking.feeGstCents)}, TVQ {formatCad(booking.feeQstCents)} incluses)
        </Text>
      ) : null}
      {quote.allowed && onCancel ? <Button label="Annuler" variant="secondary" onPress={onCancel} /> : null}
      {booking.status === 'en_attente_paiement' && onPay ? <Button label="Terminer le paiement" onPress={onPay} /> : null}
    </View>
  );
}
