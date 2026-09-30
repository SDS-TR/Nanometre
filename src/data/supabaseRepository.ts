import type { SupabaseClient } from '@supabase/supabase-js';
import { CUTS_PER_REWARD, zonedDateTime } from '../domain';
import type {
  Barber,
  BookingView,
  CreateBookingInput,
  LoyaltyView,
  Repository,
  Review,
  Salon,
  Service,
  SessionUser,
  SlotView,
} from './types';

type ProfileRow = {
  id: string;
  role: SessionUser['role'];
  full_name: string;
  phone: string | null;
  barber_id: string | null;
};

function fail(error: { message: string } | null): void {
  if (error) {
    throw new Error(error.message);
  }
}

export function createSupabaseRepository(supabase: SupabaseClient): Repository {
  let session: SessionUser | null = null;
  const listeners = new Set<() => void>();

  async function loadProfile(userId: string, email: string): Promise<SessionUser | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, role, full_name, phone, barber_id')
      .eq('id', userId)
      .maybeSingle();
    fail(error);
    const profile = data as ProfileRow | null;
    if (!profile) {
      return null;
    }
    return {
      id: profile.id,
      email,
      fullName: profile.full_name,
      role: profile.role,
      barberId: profile.barber_id,
      phone: profile.phone,
    };
  }

  const ready = (async () => {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (user?.email) {
      session = await loadProfile(user.id, user.email);
    }
    supabase.auth.onAuthStateChange(async (_event, next) => {
      if (!next?.user.email) {
        session = null;
      } else {
        session = await loadProfile(next.user.id, next.user.email);
      }
      listeners.forEach((listener) => listener());
    });
  })();

  function emit() {
    listeners.forEach((listener) => listener());
  }

  async function rows<T>(promise: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
    const { data, error } = await promise;
    fail(error);
    if (data == null) {
      throw new Error('Réponse vide du serveur.');
    }
    return data;
  }

  return {
    mode: 'supabase',
    ready,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSession() {
      return session;
    },
    async signIn(email, password) {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      fail(error);
      if (!data.user?.email) {
        throw new Error('Connexion impossible.');
      }
      session = await loadProfile(data.user.id, data.user.email);
      if (!session) {
        throw new Error('Profil introuvable.');
      }
      emit();
      return session;
    },
    async signUp({ fullName, email, password }) {
      if (password.length < 8) {
        throw new Error('Le mot de passe doit contenir au moins 8 caractères.');
      }
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { full_name: fullName.trim() } },
      });
      fail(error);
      if (!data.user?.email || !data.session) {
        throw new Error('Compte créé. Confirme le courriel si le salon l’exige, puis connecte-toi.');
      }
      session = await loadProfile(data.user.id, data.user.email);
      if (!session) {
        throw new Error('Profil introuvable.');
      }
      emit();
      return session;
    },
    async sendMagicLink(email) {
      const redirect = typeof window === 'undefined' ? 'lenanometre://auth/callback' : `${window.location.origin}/auth/callback`;
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: redirect },
      });
      fail(error);
      return { demo: false };
    },
    async completeMagicLink() {
      const { data, error } = await supabase.auth.getSession();
      fail(error);
      if (!data.session?.user.email) {
        throw new Error('Lien invalide ou expiré.');
      }
      session = await loadProfile(data.session.user.id, data.session.user.email);
      if (!session) {
        throw new Error('Profil introuvable.');
      }
      emit();
      return session;
    },
    async signOut() {
      const { error } = await supabase.auth.signOut();
      fail(error);
      session = null;
      emit();
    },
    async updateProfile({ fullName, phone }) {
      if (!session) {
        throw new Error('Connecte-toi pour continuer.');
      }
      const { error } = await supabase.from('profiles').update({ full_name: fullName.trim(), phone }).eq('id', session.id);
      fail(error);
      session = { ...session, fullName: fullName.trim(), phone };
      emit();
      return session;
    },
    async getSalon() {
      const data = await rows<Salon[]>(supabase.rpc('salon_public'));
      return data[0];
    },
    async getBarbers() {
      return rows<Barber[]>(supabase.rpc('visible_barbers'));
    },
    async getServices() {
      return rows<Service[]>(supabase.rpc('visible_services'));
    },
    async getReviews(barberId) {
      return rows<Review[]>(supabase.rpc('visible_reviews', { p_barber: barberId }));
    },
    async getSlots({ barberId, serviceId, date }) {
      return rows<SlotView[]>(
        supabase.rpc('list_slots', {
          p_service_id: serviceId,
          p_date: date,
          p_barber_id: barberId === 'any' ? null : barberId,
        }),
      );
    },
    async getMyBookings() {
      const data = await rows<BookingView[]>(supabase.rpc('my_bookings'));
      return data.sort(
        (a, b) => zonedDateTime(a.date, a.startMinute).getTime() - zonedDateTime(b.date, b.startMinute).getTime(),
      );
    },
    async getBooking(id) {
      const bookings = await rows<BookingView[]>(supabase.rpc('my_bookings'));
      const booking = bookings.find((item) => item.id === id);
      if (!booking) {
        throw new Error('Rendez-vous introuvable.');
      }
      return booking;
    },
    async createBooking(input: CreateBookingInput) {
      const id = await rows<string>(
        supabase.rpc('create_booking', {
          p_service_id: input.serviceId,
          p_barber_id: input.barberId,
          p_date: input.date,
          p_start_minute: input.startMinute,
          p_method: input.paymentMethod,
          p_redeem: input.redeemReward,
        }),
      );
      return this.getBooking(id);
    },
    async markPaid(bookingId) {
      await rows(supabase.rpc('confirm_online_payment', { p_booking: bookingId }));
      return this.getBooking(bookingId);
    },
    async confirmOnSite(bookingId) {
      await rows(supabase.rpc('confirm_on_site', { p_booking: bookingId }));
      return this.getBooking(bookingId);
    },
    async abandonCheckout(bookingId) {
      const { error } = await supabase.rpc('abandon_checkout', { p_booking: bookingId });
      fail(error);
    },
    async cancelBooking(bookingId) {
      await rows(supabase.rpc('cancel_booking', { p_booking: bookingId }));
      return this.getBooking(bookingId);
    },
    async getLoyalty() {
      const data = await rows<LoyaltyView[]>(supabase.rpc('my_loyalty'));
      return { ...data[0], cutsPerReward: data[0]?.cutsPerReward ?? CUTS_PER_REWARD };
    },
    async submitReview({ bookingId, stars, body }) {
      const { error } = await supabase.rpc('submit_review', {
        p_booking: bookingId,
        p_stars: stars,
        p_body: body,
      });
      fail(error);
    },
    async prepareOnlinePayment(bookingId) {
      const { data, error } = await supabase.functions.invoke('create-payment-intent', { body: { bookingId } });
      fail(error);
      const clientSecret = (data as { clientSecret?: string } | null)?.clientSecret ?? null;
      if (!clientSecret) {
        throw new Error('Stripe n’a pas renvoyé de PaymentIntent.');
      }
      return { mode: 'stripe' as const, clientSecret };
    },
  };
}
