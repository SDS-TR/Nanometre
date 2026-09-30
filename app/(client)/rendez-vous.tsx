import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button } from '../../src/components/Button';
import { CarteRendezVous } from '../../src/components/CarteRendezVous';
import { FeuilleAnnulation } from '../../src/components/FeuilleAnnulation';
import { Header } from '../../src/components/Header';
import { Screen } from '../../src/components/Screen';
import { SegmentedControl } from '../../src/components/SegmentedControl';
import { LoadingBlock, StateMessage } from '../../src/components/StateView';
import { useToast } from '../../src/components/Toast';
import type { BookingView } from '../../src/data/types';
import { quoteCancellation, zonedDateTime } from '../../src/domain';
import { useAsync } from '../../src/hooks/useAsync';
import { useAppState } from '../../src/providers/AppState';
import { useTheme } from '../../src/theme';

export default function RendezVousScreen() {
  const theme = useTheme();
  const router = useRouter();
  const toast = useToast();
  const { user, repo } = useAppState();
  const [tab, setTab] = useState<'avenir' | 'passes'>('avenir');
  const [target, setTarget] = useState<BookingView | null>(null);
  const [busy, setBusy] = useState(false);
  const query = useAsync(async (repository) => {
    const [bookings, salon] = await Promise.all([repository.getMyBookings(), repository.getSalon()]);
    return { bookings, salon };
  }, [user?.id]);
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const visible = useMemo(() => {
    const bookings = query.data?.bookings ?? [];
    return bookings.filter((booking) => {
      const upcoming = zonedDateTime(booking.date, booking.startMinute).getTime() > now && booking.status !== 'annule' && booking.status !== 'annule_tardif' && booking.status !== 'honore';
      return tab === 'avenir' ? upcoming || booking.status === 'en_attente_paiement' : !upcoming;
    });
  }, [query.data, tab, now]);
  const quote = target
    ? quoteCancellation({
        startsAt: zonedDateTime(target.date, target.startMinute),
        now: new Date(),
        preTaxCents: target.priceCents,
        totalCents: target.totalCents,
        paymentMethod: target.paymentMethod,
        paymentStatus: target.paymentStatus,
        status: target.status,
        gstNumber: query.data?.salon.gstNumber,
        qstNumber: query.data?.salon.qstNumber,
      })
    : null;

  async function confirmCancel() {
    if (!target) {
      return;
    }
    setBusy(true);
    try {
      await repo.cancelBooking(target.id);
      toast({ message: 'Rendez-vous annulé', tone: 'success' });
      setTarget(null);
    } catch (reason) {
      toast({ message: reason instanceof Error ? reason.message : 'Annulation impossible', tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <Header title="Rendez-vous" />
      <View style={{ padding: theme.space[4], gap: theme.space[4] }}>
        {!user ? (
          <StateMessage
            title="Connecte-toi pour voir tes rendez-vous"
            body="La réservation reste possible après la connexion."
            actionLabel="Connexion"
            onAction={() => router.push('/connexion?next=/rendez-vous')}
          />
        ) : (
          <>
            <SegmentedControl
              value={tab}
              onChange={setTab}
              options={[
                { value: 'avenir', label: 'À venir' },
                { value: 'passes', label: 'Passés' },
              ]}
            />
            {query.status === 'loading' ? <LoadingBlock /> : null}
            {query.status === 'error' ? (
              <StateMessage title="Chargement impossible" body={query.error ?? ''} actionLabel="Réessayer" onAction={query.reload} />
            ) : null}
            {query.status === 'ready' && visible.length === 0 ? (
              <StateMessage
                title={tab === 'avenir' ? 'Rien à l’horaire' : 'Pas encore de visite passée'}
                body={tab === 'avenir' ? 'Réserve une chaise, mardi au samedi.' : 'Tes coupes honorées s’afficheront ici.'}
                actionLabel={tab === 'avenir' ? 'Réserver' : undefined}
                onAction={tab === 'avenir' ? () => router.push('/reserver/prestation') : undefined}
              />
            ) : null}
            {visible.map((booking) => (
              <CarteRendezVous
                key={booking.id}
                booking={booking}
                onCancel={tab === 'avenir' ? () => setTarget(booking) : undefined}
                onPay={() => router.push({ pathname: '/reserver/paiement', params: { bookingId: booking.id } })}
              />
            ))}
          </>
        )}
        {user ? <Button label="Nouveau rendez-vous" variant="secondary" onPress={() => router.push('/reserver/prestation')} /> : null}
      </View>
      <FeuilleAnnulation
        visible={target != null}
        quote={quote}
        loading={busy}
        gstNumber={query.data?.salon.gstNumber ?? ''}
        qstNumber={query.data?.salon.qstNumber ?? ''}
        onClose={() => setTarget(null)}
        onConfirm={confirmCancel}
      />
    </Screen>
  );
}
