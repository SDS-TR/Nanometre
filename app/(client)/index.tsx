import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Linking, Pressable, ScrollView, View } from 'react-native';
import { Button } from '../../src/components/Button';
import { CarteCoiffeur } from '../../src/components/CarteCoiffeur';
import { CarteCoupe } from '../../src/components/CarteCoupe';
import { CarteRendezVous } from '../../src/components/CarteRendezVous';
import { Screen } from '../../src/components/Screen';
import { LoadingBlock, StateMessage } from '../../src/components/StateView';
import { Text } from '../../src/components/Text';
import { photos } from '../../src/data/photos';
import type { BookingView, Salon } from '../../src/data/types';
import { mapsSearchUri, phoneTelUri, salonWeekSummary, zonedDateTime } from '../../src/domain';
import { useAsync } from '../../src/hooks/useAsync';
import { useAppState } from '../../src/providers/AppState';
import { useTheme } from '../../src/theme';

export default function AccueilScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAppState();
  const catalog = useAsync(
    (repo) => Promise.all([repo.getSalon(), repo.getServices(), repo.getBarbers(), repo.getMyBookings()]),
    [user?.id],
  );
  if (catalog.status === 'loading' || !catalog.data) {
    return catalog.status === 'error' ? (
      <Screen>
        <StateMessage title="Le salon ne répond pas" body={catalog.error ?? 'Réessaie dans un instant.'} actionLabel="Réessayer" onAction={catalog.reload} />
      </Screen>
    ) : (
      <Screen>
        <LoadingBlock />
      </Screen>
    );
  }
  const [salon, services, barbers, bookings] = catalog.data;
  // Horloge murale : le prochain rendez-vous dépend de l’instant présent.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const next = bookings.find(
    (booking) =>
      (booking.status === 'confirme' || booking.status === 'en_attente_paiement') &&
      zonedDateTime(booking.date, booking.startMinute).getTime() > now,
  );
  return (
    <Screen>
      <View style={{ height: 460 }}>
        <Image source={photos.hero} style={{ width: '100%', height: '100%' }} contentFit="cover" />
        <LinearGradient
          colors={[`${theme.color.bg.default}26`, theme.color.bg.default]}
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 280 }}
        />
        <View style={{ position: 'absolute', left: theme.space[4], right: theme.space[4], bottom: theme.space[5], gap: theme.space[2] }}>
          <Text variant="overline" color={theme.color.accent.default}>
            {salon.tagline}
          </Text>
          <Text variant="display-lg">{salon.name}</Text>
          <Text variant="body-md" color={theme.color.text.secondary}>
            {salon.city}
          </Text>
          {salonWeekSummary(salon.week).map((line) => (
            <Text key={line} variant="body-sm" color={theme.color.text.muted}>
              {line}
            </Text>
          ))}
        </View>
      </View>
      <View style={{ padding: theme.space[4], gap: theme.space[6] }}>
        <Button label="Réserver" size="lg" fullWidth onPress={() => router.push('/reserver/prestation')} />
        {next ? <NextAppointment booking={next} /> : null}
        <Section title="Prestations">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space[3] }}>
            {services.map((service) => (
              <CarteCoupe
                key={service.id}
                service={service}
                onPress={() => router.push({ pathname: '/reserver/coiffeur', params: { serviceId: service.id } })}
              />
            ))}
          </ScrollView>
        </Section>
        <Section title="Les coiffeurs">
          <View style={{ gap: theme.space[3] }}>
            {barbers.map((barber) => (
              <CarteCoiffeur key={barber.id} barber={barber} onPress={() => router.push(`/coiffeur/${barber.id}`)} />
            ))}
          </View>
        </Section>
        <Address salon={salon} />
      </View>
    </Screen>
  );
}

function NextAppointment({ booking }: { booking: BookingView }) {
  const theme = useTheme();
  const router = useRouter();
  return (
    <View style={{ gap: theme.space[3] }}>
      <Text variant="heading-md">Ton prochain rendez-vous</Text>
      <CarteRendezVous booking={booking} onPay={booking.status === 'en_attente_paiement' ? () => router.push('/rendez-vous') : undefined} />
    </View>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[3] }}>
      <Text variant="heading-md">{title}</Text>
      {children}
    </View>
  );
}

function Address({ salon }: { salon: Salon }) {
  const theme = useTheme();
  const [error, setError] = useState<string | null>(null);

  async function openExternal(buildUrl: () => string) {
    try {
      await Linking.openURL(buildUrl());
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Le lien ne s’ouvre pas sur cet appareil.');
    }
  }

  return (
    <View style={{ gap: theme.space[1], paddingBottom: theme.space[4] }}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Itinéraire vers ${salon.address}`}
        onPress={() => void openExternal(() => mapsSearchUri(salon.address, salon.city))}
      >
        <Text variant="label-md" color={theme.color.accent.default} style={{ textDecorationLine: 'underline' }}>
          {salon.address}
        </Text>
      </Pressable>
      <Text variant="body-sm" color={theme.color.text.secondary}>
        {salon.city}
      </Text>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={`Appeler le salon au ${salon.phone}`}
        onPress={() => void openExternal(() => phoneTelUri(salon.phone))}
      >
        <Text variant="caption" color={theme.color.accent.default} style={{ textDecorationLine: 'underline' }}>
          {salon.phone}
        </Text>
      </Pressable>
      {error ? (
        <Text variant="caption" color={theme.color.error.default}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
