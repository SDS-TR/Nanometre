import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { Button } from '../../src/components/Button';
import { Header } from '../../src/components/Header';
import { ProgressSteps } from '../../src/components/ProgressSteps';
import { RecapReservation } from '../../src/components/RecapReservation';
import { Screen } from '../../src/components/Screen';
import { StateMessage } from '../../src/components/StateView';
import { computeLineTaxes } from '../../src/domain';
import { useAsync } from '../../src/hooks/useAsync';
import { useDraft } from '../../src/providers/BookingDraft';
import { useTheme } from '../../src/theme';

export default function RecapScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { draft } = useDraft();
  const query = useAsync((repo) => Promise.all([repo.getServices(), repo.getBarbers()]), []);
  const service = query.data?.[0].find((item) => item.id === draft.serviceId);
  const barberId = draft.assignedBarberId || (draft.barberId !== 'any' ? draft.barberId : undefined);
  const barber = query.data?.[1].find((item) => item.id === barberId);
  const ready = Boolean(service && barber && draft.date && draft.startMinute != null && draft.endMinute != null);
  const taxes = computeLineTaxes(draft.redeem ? 0 : (service?.priceCents ?? 0));
  return (
    <Screen
      footer={
        <Button label="Continuer vers le paiement" size="lg" fullWidth disabled={!ready} onPress={() => router.push('/reserver/paiement')} />
      }
    >
      <Header back title="Récapitulatif" />
      <View style={{ padding: theme.space[4], gap: theme.space[4] }}>
        <ProgressSteps step={4} total={5} />
        {!ready ? (
          <StateMessage title="Il manque un choix" body="Reviens compléter la prestation, le coiffeur et l’heure." actionLabel="Recommencer" onAction={() => router.replace('/reserver/prestation')} />
        ) : (
          <RecapReservation
            serviceName={service?.name ?? ''}
            barberName={barber?.fullName ?? ''}
            date={draft.date ?? ''}
            startMinute={draft.startMinute ?? 0}
            endMinute={draft.endMinute ?? 0}
            paymentLabel="Choisi à l’étape suivante"
            subtotalCents={taxes.subtotalCents}
            gstCents={taxes.gstCents}
            qstCents={taxes.qstCents}
            totalCents={taxes.totalCents}
          />
        )}
      </View>
    </Screen>
  );
}
