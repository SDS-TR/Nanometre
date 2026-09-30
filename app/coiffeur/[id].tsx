import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { View } from 'react-native';
import { Button } from '../../src/components/Button';
import { CarteCoupe } from '../../src/components/CarteCoupe';
import { Header } from '../../src/components/Header';
import { RatingStars } from '../../src/components/RatingStars';
import { Screen } from '../../src/components/Screen';
import { LoadingBlock, StateMessage } from '../../src/components/StateView';
import { Text } from '../../src/components/Text';
import { photoSource } from '../../src/data/photos';
import { useAsync } from '../../src/hooks/useAsync';
import { useTheme } from '../../src/theme';

export default function ProfilCoiffeurScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const router = useRouter();
  const query = useAsync(
    async (repo) => {
      const [barbers, services, reviews] = await Promise.all([repo.getBarbers(), repo.getServices(), repo.getReviews(id)]);
      const barber = barbers.find((item) => item.id === id);
      if (!barber) {
        throw new Error('Ce coiffeur n’est plus à l’horaire.');
      }
      return { barber, services, reviews };
    },
    [id],
  );
  if (query.status === 'loading' || !query.data) {
    return (
      <Screen>
        <Header back title="Coiffeur" />
        {query.status === 'error' ? (
          <StateMessage title="Profil indisponible" body={query.error ?? ''} actionLabel="Réessayer" onAction={query.reload} />
        ) : (
          <LoadingBlock />
        )}
      </Screen>
    );
  }
  const { barber, services, reviews } = query.data;
  return (
    <Screen
      footer={
        <Button
          label={`Réserver avec ${barber.shortName}`}
          size="lg"
          fullWidth
          onPress={() => router.push({ pathname: '/reserver/prestation', params: { barberId: barber.id } })}
        />
      }
    >
      <Header back title={barber.fullName} />
      <Image source={photoSource(barber.photo)} style={{ width: '100%', height: 280 }} contentFit="cover" contentPosition="top" />
      <View style={{ padding: theme.space[4], gap: theme.space[5] }}>
        <View style={{ gap: theme.space[2] }}>
          <Text variant="heading-lg">{barber.fullName}</Text>
          <Text variant="body-md" color={theme.color.text.secondary}>
            {barber.specialty} · {barber.years} ans de métier
          </Text>
          <RatingStars value={barber.rating} count={barber.reviewCount} />
        </View>
        <View style={{ gap: theme.space[2] }}>
          <Text variant="heading-sm">À propos</Text>
          <Text variant="body-md" color={theme.color.text.secondary}>
            {barber.bio}
          </Text>
        </View>
        <View style={{ gap: theme.space[3] }}>
          <Text variant="heading-sm">Prestations</Text>
          {services.map((service) => (
            <CarteCoupe
              key={service.id}
              service={service}
              layout="liste"
              onPress={() =>
                router.push({ pathname: '/reserver/creneau', params: { serviceId: service.id, barberId: barber.id } })
              }
            />
          ))}
        </View>
        <View style={{ gap: theme.space[3] }}>
          <Text variant="heading-sm">Avis</Text>
          {reviews.length === 0 ? (
            <Text variant="body-sm" color={theme.color.text.muted}>
              Pas encore d’avis publié.
            </Text>
          ) : (
            reviews.slice(0, 6).map((review) => (
              <View key={review.id} style={{ gap: theme.space[1], paddingBottom: theme.space[3], borderBottomWidth: 1, borderBottomColor: theme.color.border.default }}>
                <RatingStars value={review.stars} />
                <Text variant="body-md">{review.body}</Text>
                <Text variant="caption" color={theme.color.text.muted}>
                  {review.clientName} · {review.serviceName}
                </Text>
              </View>
            ))
          )}
        </View>
        <Text variant="caption" color={theme.color.text.muted}>
          Photos provisoires, générées par IA.
        </Text>
      </View>
    </Screen>
  );
}
