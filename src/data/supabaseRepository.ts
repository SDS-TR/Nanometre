import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SupabaseClient } from '@supabase/supabase-js';
import { CUTS_PER_REWARD, zonedDateTime } from '../domain';
import { markPushClearPending, resumePushClear } from './pushClear';
import type {
  Barber,
  BookingView,
  CreateBookingInput,
  LoyaltyView,
  ManagedBarber,
  ManagedService,
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

async function inviteFailure(error: unknown, data: unknown): Promise<string> {
  if (data && typeof data === 'object' && 'error' in data && typeof data.error === 'string') {
    return data.error;
  }
  const context = error && typeof error === 'object' && 'context' in error ? (error as { context?: { json?: () => Promise<unknown> } }).context : undefined;
  if (context && typeof context.json === 'function') {
    const body = await context.json().catch(() => null);
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
      return body.error;
    }
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return 'Invitation impossible.';
}

function fail(error: { message: string } | null): void {
  if (error) {
    throw new Error(error.message);
  }
}

export function createSupabaseRepository(
  supabase: SupabaseClient,
  secureSession?: { removeItem(key: string): Promise<void>; key: string },
): Repository {
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
      try {
        await resumePushClear(AsyncStorage, () => supabase.rpc('clear_my_push_tokens'));
      } catch {
        // Reprise du jeton au prochain passage si le stockage est indisponible.
      }
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
      try {
        await resumePushClear(AsyncStorage, () => supabase.rpc('clear_my_push_tokens'));
      } catch {
        // Reprise du jeton au prochain passage si le stockage est indisponible.
      }
      emit();
      return session;
    },
    async signUp({ fullName, email, password }) {
      if (password.length < 12) {
        throw new Error('Le mot de passe doit contenir au moins 12 caractères.');
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
      try {
        await resumePushClear(AsyncStorage, () => supabase.rpc('clear_my_push_tokens'));
      } catch {
        // Reprise du jeton au prochain passage si le stockage est indisponible.
      }
      emit();
      return session;
    },
    async sendMagicLink(email) {
      const redirect = typeof window === 'undefined' ? 'https://lenanometre.ca/auth/callback' : `${window.location.origin}/auth/callback`;
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: redirect },
      });
      fail(error);
      return { demo: false };
    },
    async completeMagicLink(code: string, extra?: { tokenHash?: string; type?: string }) {
      if (extra?.tokenHash) {
        const type = extra.type === 'invite' || extra.type === 'email' || extra.type === 'magiclink' || extra.type === 'recovery' ? extra.type : 'email';
        const verified = await supabase.auth.verifyOtp({ token_hash: extra.tokenHash, type });
        fail(verified.error);
      } else {
        const existing = await supabase.auth.getSession();
        if (!existing.data.session && code && !code.includes('@')) {
          const exchanged = await supabase.auth.exchangeCodeForSession(code);
          fail(exchanged.error);
        }
      }
      const { data, error } = await supabase.auth.getSession();
      fail(error);
      if (!data.session?.user.email) {
        throw new Error('Lien invalide ou expiré.');
      }
      session = await loadProfile(data.session.user.id, data.session.user.email);
      try {
        await resumePushClear(AsyncStorage, () => supabase.rpc('clear_my_push_tokens'));
      } catch {
        // Reprise du jeton au prochain passage si le stockage est indisponible.
      }
      if (!session) {
        throw new Error('Profil introuvable.');
      }
      emit();
      return session;
    },
    async signOut() {
      try {
        const cleared = await supabase.rpc('clear_my_push_tokens');
        try {
          await markPushClearPending(AsyncStorage, Boolean(cleared.error));
        } catch {
          // Le drapeau est un rappel. La session locale se ferme quand même.
        }
      } catch {
        try {
          await markPushClearPending(AsyncStorage, true);
        } catch {
          // Hors ligne et sans stockage : on ferme quand même.
        }
      }
      try {
        await supabase.auth.signOut({ scope: 'global' });
      } catch {
        // Hors ligne, la session chiffrée est quand même retirée ensuite.
      }
      if (secureSession) {
        await secureSession.removeItem(secureSession.key);
      }
      session = null;
      emit();
    },
    async deleteAccount(confirmation, password) {
      if (confirmation !== 'SUPPRIMER') {
        throw new Error('Écris SUPPRIMER pour confirmer.');
      }
      const { data, error } = await supabase.functions.invoke('delete-account', { body: { confirmation, password } });
      if (error || (data && typeof data === 'object' && 'error' in data && data.error)) {
        throw new Error(await inviteFailure(error, data));
      }
      session = null;
      emit();
    },
    async requestAccountDeletion(email) {
      const { error } = await supabase.rpc('request_account_deletion', { p_email: email.trim() });
      fail(error);
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
      const created = await rows<{ ok?: boolean; id?: string; error?: string }>(
        supabase.rpc('create_booking', {
          p_service_id: input.serviceId,
          p_barber_id: input.barberId,
          p_date: input.date,
          p_start_minute: input.startMinute,
          p_method: input.paymentMethod,
          p_redeem: input.redeemReward,
          p_promo: input.redeemReward ? null : input.promoCode,
        }),
      );
      if (!created.ok || !created.id) {
        throw new Error(created.error ?? 'Réservation impossible.');
      }
      return this.getBooking(created.id);
    },
    async markPaid(bookingId) {
      const current = await this.getBooking(bookingId);
      if (current.status !== 'confirme') {
        throw new Error('Paiement en cours de validation.');
      }
      return current;
    },
    async confirmOnSite(bookingId) {
      await rows(supabase.rpc('confirm_on_site', { p_booking: bookingId }));
      return this.getBooking(bookingId);
    },
    async abandonCheckout(bookingId) {
      const { data, error } = await supabase.functions.invoke('abandon-checkout', { body: { bookingId } });
      if (error || (data && typeof data === 'object' && 'error' in data && data.error)) {
        throw new Error(await inviteFailure(error, data));
      }
    },
    async cancelBooking(bookingId) {
      await rows(supabase.rpc('cancel_booking', { p_booking: bookingId }));
      const { data, error } = await supabase.functions.invoke('process-refund', { body: { bookingId, kind: 'cancel' } });
      if (error || (data && typeof data === 'object' && 'error' in data && data.error)) {
        throw new Error(await inviteFailure(error, data));
      }
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
    async validatePromo(input) {
      const data = await rows<{ ok?: boolean; code?: string; discountCents?: number; error?: string }>(
        supabase.rpc('validate_promo', { p_code: input.code, p_date: input.date, p_subtotal: input.subtotalCents }),
      );
      if (data.ok === false || !data.code || data.discountCents == null) {
        throw new Error(data.error ?? 'Ce code n’est pas reconnu.');
      }
      return { code: data.code, discountCents: data.discountCents };
    },
    async setNotificationOptIn(enabled) {
      const { error } = await supabase.rpc('set_notification_opt_in', { p_enabled: enabled });
      fail(error);
    },
    async notificationOptIn() {
      return rows<boolean>(supabase.rpc('notification_opt_in'));
    },
    listMyNotifications: () => rows(supabase.rpc('my_notifications')),
    getDashboard: (input) => rows(supabase.rpc('admin_dashboard', { p_anchor: input.anchor, p_period: input.period })),
    getDay: (date) => rows(supabase.rpc('admin_day', { p_date: date })),
    getAgenda: (input) => rows(supabase.rpc('admin_agenda', { p_date: input.date, p_barber: input.barberId ?? null })),
    async blockSlot(input) {
      const { error } = await supabase.rpc('admin_block', {
        p_barber: input.barberId,
        p_date: input.date,
        p_start: input.startMinute,
        p_end: input.endMinute,
        p_reason: input.reason,
      });
      fail(error);
    },
    async unblockSlot(blockId) {
      const { error } = await supabase.rpc('admin_unblock', { p_id: blockId });
      fail(error);
    },
    async moveBooking(input) {
      const { error } = await supabase.rpc('admin_move', { p_booking: input.bookingId, p_date: input.date, p_start: input.startMinute });
      fail(error);
    },
    async honorBooking(bookingId) {
      const { error } = await supabase.rpc('admin_honor', { p_booking: bookingId });
      fail(error);
    },
    async cancelClientBooking(bookingId) {
      const { error } = await supabase.rpc('admin_cancel', { p_booking: bookingId });
      fail(error);
      const refunded = await supabase.functions.invoke('process-refund', { body: { bookingId, kind: 'cancel' } });
      if (refunded.error || (refunded.data && typeof refunded.data === 'object' && 'error' in refunded.data && refunded.data.error)) {
        throw new Error(await inviteFailure(refunded.error, refunded.data));
      }
    },
    listPayments: (input) => rows(supabase.rpc('admin_payments', { p_from: input.from, p_to: input.to })),
    async refundFee(bookingId) {
      const { error } = await supabase.rpc('admin_refund_fee', { p_booking: bookingId });
      fail(error);
      const refunded = await supabase.functions.invoke('process-refund', { body: { bookingId, kind: 'fee' } });
      if (refunded.error || (refunded.data && typeof refunded.data === 'object' && 'error' in refunded.data && refunded.data.error)) {
        throw new Error(await inviteFailure(refunded.error, refunded.data));
      }
    },
    listClients: () => rows(supabase.rpc('admin_clients')),
    async saveClientNote(clientId, note) {
      const { error } = await supabase.rpc('admin_save_note', { p_client: clientId, p_note: note });
      fail(error);
    },
    listStaffReviews: () => rows(supabase.rpc('admin_reviews')),
    async moderateReview(reviewId, status) {
      const { error } = await supabase.rpc('admin_moderate_review', { p_id: reviewId, p_status: status });
      fail(error);
    },
    listPromos: () => rows(supabase.rpc('admin_promos')),
    async savePromo(promo) {
      const { error } = await supabase.rpc('admin_save_promo', { p_promo: promo });
      fail(error);
    },
    listTeam: () => rows(supabase.rpc('admin_team')),
    async setMemberRole(userId, role) {
      const { error } = await supabase.rpc('admin_set_role', { p_user: userId, p_role: role });
      fail(error);
    },
    async setMemberActive(userId, active) {
      const { error } = await supabase.rpc('admin_set_active', { p_user: userId, p_active: active });
      fail(error);
    },
    async inviteMember(input) {
      const { data, error } = await supabase.functions.invoke('invite-team-member', {
        body: {
          fullName: input.fullName,
          email: input.email,
          role: input.role,
          barberId: input.barberId,
        },
      });
      if (error || (data && typeof data === 'object' && 'error' in data && data.error)) {
        throw new Error(await inviteFailure(error, data));
      }
      return { invited: true as const };
    },
    async updateSalonSettings(input) {
      const { error } = await supabase.rpc('admin_update_salon', {
        p_open: input.openMinute,
        p_close: input.closeMinute,
        p_policy: input.onsiteLatePolicy,
        p_force: input.force ?? false,
      });
      fail(error);
      const salon = await rows<Salon[]>(supabase.rpc('salon_public'));
      return salon[0];
    },
    async updateService(input) {
      const { error } = await supabase.rpc('admin_update_service', { p_id: input.serviceId, p_price: input.priceCents });
      fail(error);
    },
    async setBarberWeekday(input) {
      const { error } = await supabase.rpc('admin_set_weekday', {
        p_barber: input.barberId,
        p_weekday: input.weekday,
        p_open: input.open,
      });
      fail(error);
    },
    listAudit: () => rows(supabase.rpc('admin_audit')),
    getBarberSetup: () => rows(supabase.rpc('admin_barber_setup')),
    async setBarberService(input) {
      const { error } = await supabase.rpc('admin_set_service', {
        p_barber: input.barberId,
        p_service: input.serviceId,
        p_eligible: input.eligible,
      });
      fail(error);
    },
    async setPushToken(token) {
      const { error } = await supabase.rpc('set_push_token', { p_token: token });
      fail(error);
    },
    listManagedBarbers: () => rows<ManagedBarber[]>(supabase.rpc('admin_barbers')),
    async createBarber(input) {
      const id = await rows<string>(
        supabase.rpc('admin_create_barber', {
          p_full_name: input.fullName,
          p_short_name: input.shortName,
          p_specialty: input.specialty ?? '',
          p_weekdays: input.weekdays,
          p_service_ids: input.serviceIds,
        }),
      );
      return { id };
    },
    archiveBarber: (barberId) => rows<{ deactivatedAccounts: number }>(supabase.rpc('admin_archive_barber', { p_barber: barberId })),
    async reactivateBarber(barberId) {
      const { error } = await supabase.rpc('admin_reactivate_barber', { p_barber: barberId });
      fail(error);
    },
    listManagedServices: () => rows<ManagedService[]>(supabase.rpc('admin_services')),
    async createService(input) {
      const id = await rows<string>(
        supabase.rpc('admin_create_service', {
          p_name: input.name,
          p_description: input.description ?? '',
          p_duration: input.durationMinutes,
          p_price: input.priceCents,
          p_barber_ids: input.barberIds,
        }),
      );
      return { id };
    },
    async archiveService(serviceId) {
      const { error } = await supabase.rpc('admin_archive_service', { p_service: serviceId });
      fail(error);
    },
    async reactivateService(serviceId, barberIds = []) {
      const { error } = await supabase.rpc(
        'admin_reactivate_service',
        barberIds.length > 0 ? { p_service: serviceId, p_barbers: barberIds } : { p_service: serviceId },
      );
      fail(error);
    },
  };
}
