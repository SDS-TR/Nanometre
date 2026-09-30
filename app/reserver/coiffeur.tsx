import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { CarteCoiffeur } from '../../src/components/CarteCoiffeur';
import { Header } from '../../src/components/Header';
import { ProgressSteps } from '../../src/components/ProgressSteps';
import { Screen } from '../../src/components/Screen';
import { LoadingBlock, StateMessage } from '../../src/components/StateView';
import { Text } from '../../src/components/Text';
import { useAsync } from '../../src/hooks/useAsync';
import { useDraft } from '../../src/providers/BookingDraft';
import { useTheme } from '../../src/theme';

export default function CoiffeurScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ serviceId?: string }>();
  const { draft, update } = useDraft();
  const serviceId = params.serviceId || draft.serviceId;
  const query = useAsync((repo) => repo.getBarbers(), []);
  useEffect(() => {
    if (params.serviceId) {
      update({ serviceId: params.serviceId });
    }
  }, [params.serviceId, update]);
  return (
    <Screen>
      <Header back title="Coiffeur" />
      <View style={{ paddingHorizontal: theme.space[4], paddingBottom: theme.space[3] }}>
        <ProgressSteps step={2} total={5} />
      </View>
      <View style={{ padding: theme.space[4], gap: theme.space[3] }}>
        <Text variant="heading-lg">Avec qui ?</Text>
        {!serviceId ? (
          <StateMessage title="Choisis d’abord une prestation" body="Le créneau dépend de la durée." actionLabel="Prestations" onAction={() => router.replace('/reserver/prestation')} />
        ) : null}
        {serviceId ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              update({ barberId: 'any', startMinute: undefined });
              router.push('/reserver/creneau');
            }}
            style={{
              minHeight: theme.touchTarget.min,
              borderRadius: theme.radius.lg,
              borderWidth: draft.barberId === 'any' ? 2 : 1,
              borderColor: draft.barberId === 'any' ? theme.color.accent.default : theme.color.border.default,
              backgroundColor: theme.color.accent.subtle,
              padding: theme.space[4],
              gap: 2,
            }}
          >
            <Text variant="label-md">Peu importe</Text>
            <Text variant="body-sm" color={theme.color.text.secondary}>
              Le premier coiffeur libre
            </Text>
          </Pressable>
        ) : null}
        {query.status === 'loading' ? <LoadingBlock /> : null}
        {query.status === 'error' ? (
          <StateMessage title="Équipe indisponible" body={query.error ?? ''} actionLabel="Réessayer" onAction={query.reload} />
        ) : null}
        {serviceId
          ? query.data?.map((barber) => (
              <CarteCoiffeur
                key={barber.id}
                barber={barber}
                onPress={() => {
                  update({ barberId: barber.id, startMinute: undefined });
                  router.push('/reserver/creneau');
                }}
              />
            ))
          : null}
      </View>
    </Screen>
  );
}
