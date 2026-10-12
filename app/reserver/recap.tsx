import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { Button } from '../../src/components/Button';
import { Header } from '../../src/components/Header';
import { Input } from '../../src/components/Input';
import { ProgressSteps } from '../../src/components/ProgressSteps';
import { RecapReservation } from '../../src/components/RecapReservation';
import { Screen } from '../../src/components/Screen';
import { StateMessage } from '../../src/components/StateView';
import { Text } from '../../src/components/Text';
import { computeLineTaxes, friendlyError } from '../../src/domain';
import { useAsync } from '../../src/hooks/useAsync';
import { useAppState } from '../../src/providers/AppState';
import { useDraft } from '../../src/providers/BookingDraft';
import { useTheme } from '../../src/theme';

export default function RecapScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { repo } = useAppState();
  const { draft, update } = useDraft();
  const [code, setCode] = useState(draft.promoCode ?? '');
  const [promoError, setPromoError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const query = useAsync((repository) => Promise.all([repository.getServices(), repository.getBarbers(), repository.getSalon()]), []);
  const service = query.data?.[0].find((item) => item.id === draft.serviceId);
  const barberId = draft.assignedBarberId || (draft.barberId !== 'any' ? draft.barberId : undefined);
  const barber = query.data?.[1].find((item) => item.id === barberId);
  const salon = query.data?.[2];
  const ready = Boolean(service && barber && draft.date && draft.startMinute != null && draft.endMinute != null);
  const discount = draft.redeem ? 0 : (draft.discountCents ?? 0);
  const servicePrice = service?.priceCents;
  useEffect(() => {
    if (servicePrice == null || !draft.date || !draft.promoCode || draft.redeem) {
      return;
    }
    let cancelled = false;
    void repo
      .validatePromo({ code: draft.promoCode, date: draft.date, subtotalCents: servicePrice })
      .then(
        (quote) => {
          if (!cancelled) {
            update({ promoCode: quote.code, discountCents: quote.discountCents });
          }
        },
        () => {
          if (!cancelled) {
            update({ promoCode: null, discountCents: 0 });
          }
        },
      );
    return () => {
      cancelled = true;
    };
  }, [servicePrice, draft.date, draft.promoCode, draft.redeem, repo, update]);
  const taxes = computeLineTaxes(draft.redeem ? 0 : Math.max(0, (service?.priceCents ?? 0) - discount));
  const policyNote =
    salon?.onsiteLatePolicy === 'a_la_prochaine'
      ? 'Annulation gratuite jusqu’à 24 h avant. Moins de 24 h et payé en ligne : 50 % du prix avant taxes, taxes incluses, est retenu. Sur place, le même montant est dû à la prochaine visite.'
      : undefined;

  async function applyCode() {
    if (!service || !draft.date || draft.redeem) {
      return;
    }
    setChecking(true);
    setPromoError(null);
    try {
      const quote = await repo.validatePromo({ code, date: draft.date, subtotalCents: service.priceCents });
      update({ promoCode: quote.code, discountCents: quote.discountCents });
    } catch (reason) {
      update({ promoCode: null, discountCents: 0 });
      setPromoError(friendlyError(reason, 'Code refusé.'));
    } finally {
      setChecking(false);
    }
  }

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
            discountCents={discount}
            promoCode={draft.promoCode}
            policyNote={policyNote}
          />
        )}
        {ready && !draft.redeem ? (
          <View style={{ gap: theme.space[2] }}>
            <Input label="Code promo" value={code} onChangeText={setCode} autoCapitalize="none" placeholder="BIENVENUE10" />
            <Button label="Appliquer le code" variant="secondary" loading={checking} onPress={() => void applyCode()} />
            {promoError ? (
              <Text variant="body-sm" color={theme.color.error.default}>
                {promoError}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
