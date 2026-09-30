import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { CarteCoupe } from '../../src/components/CarteCoupe';
import { Header } from '../../src/components/Header';
import { ProgressSteps } from '../../src/components/ProgressSteps';
import { Screen } from '../../src/components/Screen';
import { LoadingBlock, StateMessage } from '../../src/components/StateView';
import { Text } from '../../src/components/Text';
import { useAsync } from '../../src/hooks/useAsync';
import { useDraft } from '../../src/providers/BookingDraft';
import { useTheme } from '../../src/theme';

export default function PrestationScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ barberId?: string }>();
  const { draft, update } = useDraft();
  const query = useAsync((repo) => repo.getServices(), []);
  useEffect(() => {
    if (params.barberId) {
      update({ barberId: params.barberId });
    }
  }, [params.barberId, update]);
  return (
    <Screen>
      <Header back title="Prestation" />
      <View style={{ paddingHorizontal: theme.space[4], paddingBottom: theme.space[3] }}>
        <ProgressSteps step={1} total={5} />
      </View>
      <View style={{ padding: theme.space[4], gap: theme.space[3] }}>
        <Text variant="heading-lg">Quelle coupe ?</Text>
        <Text variant="body-md" color={theme.color.text.secondary}>
          Les prix sont avant taxes. La TPS et la TVQ s’ajoutent au récapitulatif.
        </Text>
        {query.status === 'loading' ? <LoadingBlock /> : null}
        {query.status === 'error' ? (
          <StateMessage title="Prestations indisponibles" body={query.error ?? ''} actionLabel="Réessayer" onAction={query.reload} />
        ) : null}
        {query.data?.map((service) => (
          <CarteCoupe
            key={service.id}
            service={service}
            layout="liste"
            selected={draft.serviceId === service.id}
            onPress={() => {
              update({ serviceId: service.id, startMinute: undefined, bookingId: undefined });
              router.push('/reserver/coiffeur');
            }}
          />
        ))}
      </View>
    </Screen>
  );
}
