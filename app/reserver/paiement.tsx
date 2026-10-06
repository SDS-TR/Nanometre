import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { BottomSheet } from '../../src/components/BottomSheet';
import { Button } from '../../src/components/Button';
import { ChoixDePaiement } from '../../src/components/ChoixDePaiement';
import { Header } from '../../src/components/Header';
import { ProgressSteps } from '../../src/components/ProgressSteps';
import { Screen } from '../../src/components/Screen';
import { StateMessage } from '../../src/components/StateView';
import { Text } from '../../src/components/Text';
import { computeLineTaxes, payButtonLabel } from '../../src/domain';
import { useAsync } from '../../src/hooks/useAsync';
import { nativePayAvailable, presentNativePaymentSheet } from '../../src/lib/stripePayment';
import { useAppState } from '../../src/providers/AppState';
import { useDraft } from '../../src/providers/BookingDraft';
import { useTheme } from '../../src/theme';

export default function PaiementScreen() {
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ bookingId?: string }>();
  const { user, repo } = useAppState();
  const { draft, update, reset } = useDraft();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<'form' | 'processing'>('form');
  const [demoOpen, setDemoOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(params.bookingId ?? draft.bookingId ?? null);
  const settled = useRef(false);
  useEffect(() => {
    return () => {
      if (pendingId && !settled.current && draft.paymentMethod === 'en_ligne') {
        void repo.abandonCheckout(pendingId).catch(() => undefined);
      }
    };
  }, [pendingId, repo, draft.paymentMethod]);
  const loyalty = useAsync((repository) => (user ? repository.getLoyalty() : Promise.resolve(null)), [user?.id]);
  const existing = useAsync(
    (repository) => (params.bookingId ? repository.getBooking(params.bookingId) : Promise.resolve(null)),
    [params.bookingId],
  );
  const booking = existing.data;
  const preview = useAsync(async (repository) => {
    if (booking || !draft.serviceId) {
      return null;
    }
    const services = await repository.getServices();
    return services.find((service) => service.id === draft.serviceId) ?? null;
  }, [draft.serviceId, booking?.id]);
  const quoted = useAsync(async (repository) => {
    if (booking || draft.redeem || !draft.promoCode || !draft.date || !preview.data) {
      return null;
    }
    return repository.validatePromo({ code: draft.promoCode, date: draft.date, subtotalCents: preview.data.priceCents });
  }, [booking?.id, draft.redeem, draft.promoCode, draft.date, preview.data?.id, preview.data?.priceCents]);
  const waitingQuote = Boolean(!booking && draft.promoCode && !draft.redeem && quoted.status === 'loading' && quoted.data == null);
  const discount = booking || draft.redeem || waitingQuote ? 0 : (quoted.data?.discountCents ?? 0);
  const preTax = booking
    ? booking.priceCents
    : draft.redeem
      ? 0
      : preview.data
        ? Math.max(0, preview.data.priceCents - discount)
        : undefined;
  const shown = waitingQuote || preTax == null ? null : booking ? booking.totalCents : computeLineTaxes(preTax).totalCents;
  const label = payButtonLabel(draft.paymentMethod, shown);

  async function ensureBooking() {
    if (pendingId) {
      const current = await repo.getBooking(pendingId);
      if (draft.paymentMethod === 'sur_place' && current.paymentMethod !== 'sur_place') {
        return repo.confirmOnSite(current.id);
      }
      if (draft.paymentMethod === 'en_ligne' && current.status === 'confirme' && current.paymentMethod === 'sur_place') {
        return current;
      }
      return current;
    }
    const barberId = draft.assignedBarberId || draft.barberId;
    if (!draft.serviceId || !barberId || barberId === 'any' || !draft.date || draft.startMinute == null) {
      throw new Error('Le récapitulatif est incomplet.');
    }
    const created = await repo.createBooking({
      serviceId: draft.serviceId,
      barberId,
      date: draft.date,
      startMinute: draft.startMinute,
      paymentMethod: draft.paymentMethod,
      redeemReward: draft.redeem,
      promoCode: draft.redeem ? null : draft.promoCode,
    });
    setPendingId(created.id);
    update({ bookingId: created.id });
    return created;
  }

  async function finish(id: string) {
    settled.current = true;
    setPhase('processing');
    if (repo.mode === 'local') {
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    reset();
    router.replace({ pathname: '/reserver/confirmation', params: { bookingId: id } });
  }

  async function pay() {
    if (!user) {
      router.push('/connexion?next=/reserver/paiement');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const created = await ensureBooking();
      if (draft.paymentMethod === 'sur_place' || created.paymentMethod === 'sur_place') {
        const confirmed = created.status === 'confirme' ? created : await repo.confirmOnSite(created.id);
        await finish(confirmed.id);
        return;
      }
      const prepared = await repo.prepareOnlinePayment(created.id);
      if (prepared.mode === 'stripe' && nativePayAvailable && prepared.clientSecret) {
        const result = await presentNativePaymentSheet(prepared.clientSecret);
        if (result === 'canceled') {
          await repo.abandonCheckout(created.id);
          setPendingId(null);
          update({ bookingId: undefined });
          return;
        }
        if (result === 'failed') {
          setError('Paiement refusé par la banque. Réessaie ou paie sur place.');
          return;
        }
        const deadline = Date.now() + 20_000;
        let confirmed = created;
        while (Date.now() < deadline) {
          confirmed = await repo.getBooking(created.id);
          if (confirmed.status === 'confirme') {
            await finish(confirmed.id);
            return;
          }
          await new Promise((resolve) => setTimeout(resolve, 1500));
        }
        setError('Paiement en cours de validation. Ton rendez-vous se confirme dès que Stripe nous répond.');
        return;
      }
      if (repo.mode !== 'local') {
        setError('Paiement en ligne indisponible sur cet appareil, paie sur place.');
        return;
      }
      setDemoOpen(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Paiement impossible.');
    } finally {
      setLoading(false);
    }
  }

  async function demoResult(refused: boolean) {
    setDemoOpen(false);
    if (!pendingId) {
      return;
    }
    if (refused) {
      setError('Paiement refusé par la banque. Réessaie ou paie sur place.');
      return;
    }
    setLoading(true);
    try {
      const paid = await repo.markPaid(pendingId);
      await finish(paid.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Paiement impossible.');
    } finally {
      setLoading(false);
    }
  }

  const draftReady = Boolean(
    pendingId || (draft.serviceId && draft.barberId && draft.date && draft.startMinute != null),
  );

  if (!draftReady) {
    return (
      <Screen>
        <Header back title="Paiement" />
        <StateMessage
          title="Parcours incomplet"
          body="Le récapitulatif a été perdu. Reprends à la prestation."
          actionLabel="Recommencer"
          onAction={() => router.replace('/reserver/prestation')}
        />
      </Screen>
    );
  }

  if (phase === 'processing') {
    return (
      <Screen>
        <Header title="Paiement" />
        <StateMessage title="Paiement en cours" body="On confirme ta place. Ça ne prend qu’un instant." />
      </Screen>
    );
  }

  return (
    <Screen footer={<Button label={label} size="lg" fullWidth loading={loading} onPress={pay} />}>
      <Header back title="Paiement" />
      <View style={{ padding: theme.space[4], gap: theme.space[4] }}>
        <ProgressSteps step={5} total={5} />
        <Text variant="heading-lg">Comment veux-tu payer ?</Text>
        <ChoixDePaiement
          value={draft.paymentMethod}
          error={error}
          onChange={(paymentMethod) => {
            setError(null);
            update({ paymentMethod });
          }}
        />
        {loyalty.data && loyalty.data.rewardsAvailable > 0 && !booking ? (
          <Button
            label={draft.redeem ? 'Coupe offerte sélectionnée' : 'Utiliser ma coupe offerte'}
            variant={draft.redeem ? 'primary' : 'secondary'}
            onPress={() => {
              if (pendingId) {
                void repo.abandonCheckout(pendingId);
              }
              setPendingId(null);
              update({ redeem: !draft.redeem, bookingId: undefined });
            }}
          />
        ) : null}
        {__DEV__ ? (
          <Text variant="caption" color={theme.color.text.muted}>
            {nativePayAvailable && repo.mode === 'supabase'
              ? 'La feuille Stripe affiche la carte, Apple Pay et Google Pay.'
              : 'Sans clé Stripe native, une simulation de la PaymentSheet s’ouvre. Sur un dev build configuré, c’est la feuille du SDK.'}
          </Text>
        ) : null}
      </View>
      <BottomSheet visible={demoOpen} onClose={() => setDemoOpen(false)} title="Feuille Stripe">
        <Text variant="body-sm" color={theme.color.text.secondary}>
          Feuille native Stripe — affichée par le SDK, simulée ici. Carte de test 4242 4242 4242 4242.
        </Text>
        <Button label={label} onPress={() => demoResult(false)} />
        <Button label="Simuler un refus (4000…0002)" variant="secondary" onPress={() => demoResult(true)} />
      </BottomSheet>
    </Screen>
  );
}
