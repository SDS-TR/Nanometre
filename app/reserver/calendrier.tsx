import { useLocalSearchParams, useRouter } from 'expo-router';
import { Platform, View } from 'react-native';
import { Button } from '../../src/components/Button';
import { Header } from '../../src/components/Header';
import { Screen } from '../../src/components/Screen';
import { LoadingBlock } from '../../src/components/StateView';
import { Text } from '../../src/components/Text';
import { formatLongDate, formatTime, zonedDateTime } from '../../src/domain';
import { useAsync } from '../../src/hooks/useAsync';
import { useTheme } from '../../src/theme';

export default function CalendrierScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { bookingId } = useLocalSearchParams<{ bookingId: string }>();
  const query = useAsync(async (repo) => {
    const [booking, salon] = await Promise.all([repo.getBooking(bookingId), repo.getSalon()]);
    return { booking, salon };
  }, [bookingId]);
  const booking = query.data?.booking;
  const salon = query.data?.salon;

  function download() {
    if (!booking || !salon || Platform.OS !== 'web') {
      return;
    }
    const start = zonedDateTime(booking.date, booking.startMinute);
    const end = new Date(start.getTime() + booking.durationMinutes * 60 * 1000);
    const stamp = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Le Nanometre//FR',
      'BEGIN:VEVENT',
      `DTSTART:${stamp(start)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:Le Nanomètre — ${booking.serviceName}`,
      `LOCATION:${salon.address}, ${salon.city}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const blob = new Blob([ics], { type: 'text/calendar' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'le-nanometre.ics';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Screen footer={<Button label="Mes rendez-vous" size="lg" fullWidth onPress={() => router.replace('/rendez-vous')} />}>
      <Header back title="Calendrier" />
      {!booking || !salon ? (
        <LoadingBlock />
      ) : (
        <View style={{ padding: theme.space[4], gap: theme.space[3] }}>
          <Text variant="overline" color={theme.color.success.default}>
            Ajouté au calendrier
          </Text>
          <Text variant="heading-lg">Le rendez-vous est noté.</Text>
          <Text variant="body-lg" color={theme.color.text.secondary}>
            {formatLongDate(booking.date)} à {formatTime(booking.startMinute)}, {salon.address}.
          </Text>
          {Platform.OS === 'web' ? (
            <Button label="Télécharger le fichier .ics" variant="secondary" onPress={download} />
          ) : (
            <Text variant="body-sm" color={theme.color.text.muted}>
              Sur l’appareil, le partage vers le calendrier système se branche au dev build. Le rendez-vous reste dans l’application.
            </Text>
          )}
        </View>
      )}
    </Screen>
  );
}
