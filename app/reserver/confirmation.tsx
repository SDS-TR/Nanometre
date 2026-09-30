import { useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';
import { Button } from '../../src/components/Button';
import { Header } from '../../src/components/Header';
import { Screen } from '../../src/components/Screen';
import { LoadingBlock, StateMessage } from '../../src/components/StateView';
import { Text } from '../../src/components/Text';
import { formatCad, formatLongDate, formatTimeRange } from '../../src/domain';
import { useAsync } from '../../src/hooks/useAsync';
import { useTheme } from '../../src/theme';

export default function ConfirmationScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const query = useAsync((repo) => repo.getBooking(bookingId), [bookingId]);
  const booking = query.data;
  return (
    <Screen
      footer={
        booking ? (
          <View style={{ gap: theme.space[2] }}>
            <Button
              label="Ajouter au calendrier"
              size="lg"
              fullWidth
              onPress={() => router.push({ pathname: '/reserver/calendrier', params: { bookingId: booking.id } })}
            />
            <Button label="Voir mes rendez-vous" variant="secondary" onPress={() => router.replace('/rendez-vous')} />
          </View>
        ) : null
      }
    >
      <Header title="Confirmé" />
      {query.status === 'loading' ? <LoadingBlock /> : null}
      {query.status === 'error' || !booking ? (
        query.status === 'error' ? <StateMessage title="Confirmation introuvable" body={query.error ?? ''} actionLabel="Mes rendez-vous" onAction={() => router.replace('/rendez-vous')} /> : null
      ) : (
        <View style={{ padding: theme.space[4], gap: theme.space[3] }}>
          <Text variant="overline" color={theme.color.accent.default}>
            C’est réservé
          </Text>
          <Text variant="display-lg">On t’attend au salon.</Text>
          <Text variant="heading-sm">
            {booking.serviceName} avec {booking.barberName}
          </Text>
          <Text variant="body-lg" color={theme.color.text.secondary}>
            {formatLongDate(booking.date)} · {formatTimeRange(booking.startMinute, booking.startMinute + booking.durationMinutes)}
          </Text>
          <Text variant="body-md" color={theme.color.text.secondary}>
            {booking.paymentMethod === 'sur_place'
              ? `À payer au fauteuil : ${formatCad(booking.totalCents)}.`
              : `Payé en ligne : ${formatCad(booking.totalCents)}. Le reçu est dans tes rendez-vous.`}
          </Text>
        </View>
      )}
    </Screen>
  );
}
