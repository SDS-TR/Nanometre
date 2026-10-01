import {
  AccessDeniedError,
  applyHonoredVisit,
  assertCan,
  assertLastOwnerSurvives,
  computeDashboard,
  formatCad,
  formatLongDate,
  formatTime,
  planBookingNotifications,
  planChangeNotification,
  quotePromo,
  scopeBarber,
  zonedDateTime,
  type PromoCode,
} from '../domain';
import type {
  Account,
  AgendaEntry,
  AuditEntry,
  BookingRecord,
  BookingView,
  ClientFile,
  DashboardView,
  NotificationView,
  PaymentLine,
  PromoView,
  Review,
  Salon,
  Service,
  TeamMember,
} from './types';

export type BlockSlot = {
  id: string;
  barberId: string;
  date: string;
  startMinute: number;
  endMinute: number;
  reason: string;
};

export type StoredNotification = NotificationView & { userId: string };

type CatalogBarber = { id: string; fullName: string; shortName: string };

export type AdminState = {
  sessionUserId: string | null;
  users: Account[];
  bookings: BookingRecord[];
  blocks: BlockSlot[];
  notes: Map<string, string>;
  promos: PromoCode[];
  openMinute: number;
  closeMinute: number;
  onsiteLatePolicy: Salon['onsiteLatePolicy'];
  schedules: Map<string, number[]>;
  notifications: StoredNotification[];
  optIn: Set<string>;
  audit: AuditEntry[];
  services: Service[];
  reviews: Review[];
  loyalty: Map<string, { points: number; stamps: number; rewardsAvailable: number }>;
  /** Prestations qu'un coiffeur peut faire. Absent = toutes. */
  eligibility: Map<string, string[]>;
};

const DEFAULT_PROMOS: PromoCode[] = [
  { code: 'ETE20', discountType: 'percent', value: 20, startsOn: '2026-07-01', endsOn: '2026-08-31', usageLimit: 30, usageCount: 30, active: true },
  { code: 'BIENVENUE10', discountType: 'percent', value: 10, startsOn: '2026-07-01', endsOn: '2026-12-31', usageLimit: 100, usageCount: 95, active: true },
  { code: 'RENTREE5', discountType: 'amount', value: 500, startsOn: '2026-09-01', endsOn: '2026-09-30', usageLimit: 50, usageCount: 12, active: true },
  { code: 'MARDI15', discountType: 'percent', value: 15, startsOn: '2026-10-06', endsOn: '2026-11-24', usageLimit: 40, usageCount: 0, active: true },
];

export function defaultPromos(): PromoCode[] {
  return DEFAULT_PROMOS.map((promo) => ({ ...promo }));
}

export function createAdmin(input: {
  state: AdminState;
  barbers: CatalogBarber[];
  emit: () => void;
}) {
  const { state, barbers, emit } = input;

  function actor(): Account {
    const user = state.users.find((item) => item.id === state.sessionUserId);
    if (!user || user.active === false) {
      throw new AccessDeniedError();
    }
    return user;
  }

  function barberName(id: string): string {
    return barbers.find((barber) => barber.id === id)?.fullName ?? 'Coiffeur';
  }

  function serviceName(id: string): string {
    return state.services.find((service) => service.id === id)?.name ?? 'Prestation';
  }

  function audit(action: string, detail: string) {
    state.audit.unshift({
      id: crypto.randomUUID(),
      action,
      detail,
      at: new Date().toISOString(),
    });
  }

  function moneyVisible(role: Account['role']): boolean {
    return role === 'proprietaire';
  }

  function toDashboard(anchor: string, period: 'jour' | 'semaine' | 'mois', barberId: string | null, includeMoney: boolean): DashboardView {
    const names = new Set(
      barbers.filter((barber) => !barberId || barber.id === barberId).map((barber) => barber.fullName),
    );
    return computeDashboard({
      anchor,
      period,
      includeMoney,
      barbers: barbers.filter((barber) => names.has(barber.fullName)).map((barber) => ({ fullName: barber.fullName })),
      bookings: state.bookings
        .filter((booking) => names.has(barberName(booking.barberId)))
        .map((booking) => ({
          date: booking.date,
          barberName: barberName(booking.barberId),
          serviceName: serviceName(booking.serviceId),
          durationMinutes: booking.durationMinutes,
          priceCents: booking.priceCents,
          discountCents: booking.discountCents ?? 0,
          totalCents: booking.totalCents,
          feeCents: booking.feeCents,
          feeHtCents: booking.feeHtCents,
          status: booking.status,
        })),
    });
  }

  function summary(booking: BookingRecord): string {
    return `${serviceName(booking.serviceId)} avec ${barberName(booking.barberId)}, ${formatLongDate(booking.date)} à ${formatTime(booking.startMinute)}.`;
  }

  function pushDrafts(booking: BookingRecord, drafts: ReturnType<typeof planBookingNotifications>) {
    const client = state.users.find((user) => user.id === booking.clientId);
    const barberUser = state.users.find((user) => user.barberId === booking.barberId && user.role !== 'client');
    for (const draft of drafts) {
      const userId = draft.recipient === 'client' ? client?.id : barberUser?.id;
      if (!userId || !state.optIn.has(userId)) {
        continue;
      }
      state.notifications.push({
        id: crypto.randomUUID(),
        userId,
        kind: draft.kind,
        title: draft.title,
        body: draft.body,
        path: draft.path,
        sendAt: draft.sendAt.toISOString(),
        status: 'planifie',
      });
    }
  }

  return {
    quotePromo(code: string, date: string, subtotalCents: number) {
      const promo = state.promos.find((item) => item.code.toLowerCase() === code.trim().toLowerCase());
      const quote = quotePromo(promo, date, subtotalCents);
      if (!quote.ok) {
        throw new Error(quote.reason);
      }
      return quote;
    },
    consumePromo(code: string) {
      const promo = state.promos.find((item) => item.code === code);
      if (promo) {
        promo.usageCount += 1;
      }
    },
    releasePromo(code: string | null | undefined) {
      if (!code) {
        return;
      }
      const promo = state.promos.find((item) => item.code === code);
      if (promo && promo.usageCount > 0) {
        promo.usageCount -= 1;
      }
    },
    notifyConfirmed(booking: BookingRecord) {
      pushDrafts(
        booking,
        planBookingNotifications({
          bookingId: booking.id,
          startsAt: zonedDateTime(booking.date, booking.startMinute),
          createdAt: new Date(),
          summary: `C’est réservé. ${summary(booking)}`,
        }),
      );
    },
    notifyChange(booking: BookingRecord, kind: 'annulation' | 'changement', text: string) {
      state.notifications.forEach((job) => {
        if (job.kind.startsWith('rappel') && job.path.includes(booking.id) && job.status === 'planifie') {
          job.status = 'annule';
        }
      });
      pushDrafts(
        booking,
        planChangeNotification({
          bookingId: booking.id,
          at: new Date(),
          summary: text,
          kind,
        }),
      );
    },
    async setNotificationOptIn(enabled: boolean) {
      const user = actor();
      if (enabled) {
        state.optIn.add(user.id);
      } else {
        state.optIn.delete(user.id);
      }
      emit();
    },
    async notificationOptIn() {
      const user = state.users.find((item) => item.id === state.sessionUserId);
      return Boolean(user && state.optIn.has(user.id));
    },
    async listMyNotifications(): Promise<NotificationView[]> {
      const user = state.users.find((item) => item.id === state.sessionUserId);
      if (!user) {
        return [];
      }
      return state.notifications
        .filter((job) => job.userId === user.id)
        .sort((a, b) => a.sendAt.localeCompare(b.sendAt))
        .map(({ userId: _userId, ...job }) => job);
    },
    async getDashboard(anchor: string, period: 'jour' | 'semaine' | 'mois') {
      const user = actor();
      assertCan(user.role, 'dashboard');
      return toDashboard(anchor, period, null, true);
    },
    async getDay(date: string) {
      const user = actor();
      assertCan(user.role, 'day');
      const barberId = user.role === 'coiffeur' ? scopeBarber(user.role, user.barberId, null) : null;
      return toDashboard(date, 'jour', barberId, moneyVisible(user.role));
    },
    async getAgenda(date: string, requested: string | null): Promise<AgendaEntry[]> {
      const user = actor();
      assertCan(user.role, 'agenda');
      const barberId = scopeBarber(user.role, user.barberId, requested);
      const showMoney = moneyVisible(user.role);
      const now = Date.now();
      const bookings: AgendaEntry[] = state.bookings
        .filter((booking) => booking.date === date && (!barberId || booking.barberId === barberId))
        .filter((booking) => booking.status !== 'annule' && booking.status !== 'annule_tardif')
        .map((booking) => ({
          kind: 'booking' as const,
          id: booking.id,
          barberId: booking.barberId,
          barberName: barberName(booking.barberId),
          startMinute: booking.startMinute,
          endMinute: booking.startMinute + booking.durationMinutes,
          title: booking.clientName,
          subtitle: serviceName(booking.serviceId),
          status: booking.status,
          priceLabel: showMoney ? formatCad(booking.totalCents) : null,
          canHonor: booking.status === 'confirme' && zonedDateTime(booking.date, booking.startMinute).getTime() <= now,
          canMove: user.role === 'proprietaire' && booking.status === 'confirme',
          canCancel: user.role === 'proprietaire' && (booking.status === 'confirme' || booking.status === 'en_attente_paiement'),
        }));
      const blocks: AgendaEntry[] = state.blocks
        .filter((block) => block.date === date && (!barberId || block.barberId === barberId))
        .map((block) => ({
          kind: 'block' as const,
          id: block.id,
          barberId: block.barberId,
          barberName: barberName(block.barberId),
          startMinute: block.startMinute,
          endMinute: block.endMinute,
          title: 'Bloqué',
          subtitle: block.reason,
          priceLabel: null,
          canHonor: false,
          canMove: false,
          canCancel: false,
        }));
      return [...bookings, ...blocks].sort((a, b) => a.startMinute - b.startMinute || a.barberName.localeCompare(b.barberName, 'fr'));
    },
    async blockSlot(payload: { barberId: string; date: string; startMinute: number; endMinute: number; reason: string }) {
      const user = actor();
      assertCan(user.role, 'block');
      const barberId = scopeBarber(user.role, user.barberId, payload.barberId);
      if (!barberId) {
        throw new Error('Choisis un coiffeur.');
      }
      if (payload.endMinute <= payload.startMinute) {
        throw new Error('L’heure de fin doit suivre l’heure de début.');
      }
      const clash = state.bookings.some(
        (booking) =>
          booking.barberId === barberId &&
          booking.date === payload.date &&
          (booking.status === 'confirme' || booking.status === 'honore' || booking.status === 'en_attente_paiement') &&
          booking.startMinute < payload.endMinute &&
          booking.startMinute + booking.durationMinutes > payload.startMinute,
      );
      if (clash) {
        throw new Error('Ce créneau a déjà un rendez-vous.');
      }
      state.blocks.push({
        id: crypto.randomUUID(),
        barberId,
        date: payload.date,
        startMinute: payload.startMinute,
        endMinute: payload.endMinute,
        reason: payload.reason.trim() || 'Indisponible',
      });
      emit();
    },
    async unblockSlot(blockId: string) {
      const user = actor();
      assertCan(user.role, 'block');
      const block = state.blocks.find((item) => item.id === blockId);
      if (!block) {
        throw new Error('Blocage introuvable.');
      }
      scopeBarber(user.role, user.barberId, block.barberId);
      state.blocks = state.blocks.filter((item) => item.id !== blockId);
      emit();
    },
    async moveBooking(payload: { bookingId: string; date: string; startMinute: number }) {
      const user = actor();
      assertCan(user.role, 'move');
      const booking = state.bookings.find((item) => item.id === payload.bookingId);
      if (!booking || booking.status !== 'confirme') {
        throw new Error('Ce rendez-vous ne peut pas être déplacé.');
      }
      const end = payload.startMinute + booking.durationMinutes;
      const clash = state.bookings.some(
        (other) =>
          other.id !== booking.id &&
          other.barberId === booking.barberId &&
          other.date === payload.date &&
          (other.status === 'confirme' || other.status === 'honore' || other.status === 'en_attente_paiement') &&
          other.startMinute < end &&
          other.startMinute + other.durationMinutes > payload.startMinute,
      );
      if (clash || payload.startMinute < state.openMinute || end > state.closeMinute) {
        throw new Error('Ce créneau n’est pas libre.');
      }
      booking.date = payload.date;
      booking.startMinute = payload.startMinute;
      audit('deplacement', `${booking.clientName} → ${formatLongDate(payload.date)} ${formatTime(payload.startMinute)}`);
      this.notifyChange(booking, 'changement', `Ton rendez-vous est maintenant le ${formatLongDate(booking.date)} à ${formatTime(booking.startMinute)}.`);
      emit();
    },
    async honorBooking(bookingId: string) {
      const user = actor();
      assertCan(user.role, 'honor');
      const booking = state.bookings.find((item) => item.id === bookingId);
      if (!booking || booking.status !== 'confirme') {
        throw new Error('Cette visite ne peut pas être honorée.');
      }
      scopeBarber(user.role, user.barberId, booking.barberId);
      if (zonedDateTime(booking.date, booking.startMinute).getTime() > Date.now()) {
        throw new Error('La visite n’a pas encore commencé.');
      }
      booking.status = 'honore';
      if (booking.paymentMethod === 'sur_place' && booking.paymentStatus === 'a_encaisser') {
        booking.paymentStatus = 'paye';
      }
      if (booking.clientId && !booking.loyaltyRedeemed) {
        const current = state.loyalty.get(booking.clientId) ?? { points: 0, stamps: 0, rewardsAvailable: 0 };
        state.loyalty.set(booking.clientId, applyHonoredVisit(current, booking.priceCents, false));
      }
      emit();
    },
    async cancelClientBooking(bookingId: string, run: (id: string) => Promise<BookingView>) {
      const user = actor();
      assertCan(user.role, 'cancelClient');
      const booking = await run(bookingId);
      audit('annulation', `${booking.clientName} · ${formatLongDate(booking.date)}`);
      emit();
      return booking;
    },
    async listPayments(from: string, to: string): Promise<PaymentLine[]> {
      const user = actor();
      assertCan(user.role, 'payments');
      return state.bookings
        .filter((booking) => booking.date >= from && booking.date <= to)
        .map((booking) => ({
          bookingId: booking.id,
          date: booking.date,
          clientName: booking.clientName,
          label: `${serviceName(booking.serviceId)} · ${barberName(booking.barberId)}`,
          method: booking.paymentMethod,
          status: booking.paymentStatus,
          amountCents: booking.totalCents,
          feeCents: booking.feeCents,
          refundedCents: booking.refundedCents,
          feeRefunded: booking.feeCents === 0 && booking.paymentStatus === 'rembourse',
        }))
        .sort((a, b) => b.date.localeCompare(a.date));
    },
    async refundFee(bookingId: string) {
      const user = actor();
      assertCan(user.role, 'refund');
      const booking = state.bookings.find((item) => item.id === bookingId);
      if (!booking || booking.feeCents <= 0) {
        throw new Error('Aucun frais à rembourser.');
      }
      const fee = booking.feeCents;
      booking.refundedCents += fee;
      booking.feeCents = 0;
      booking.feeGstCents = 0;
      booking.feeQstCents = 0;
      booking.feeHtCents = 0;
      booking.paymentStatus = 'rembourse';
      audit('remboursement_frais', `${formatCad(fee)} à ${booking.clientName}`);
      emit();
    },
    async listClients(): Promise<ClientFile[]> {
      const user = actor();
      assertCan(user.role, 'clients');
      const showMoney = moneyVisible(user.role) && canLoyalty(user.role);
      const barberId = user.role === 'coiffeur' ? scopeBarber(user.role, user.barberId, null) : null;
      const groups = new Map<string, BookingRecord[]>();
      for (const booking of state.bookings) {
        if (barberId && booking.barberId !== barberId) {
          continue;
        }
        const key = booking.clientId ? `user:${booking.clientId}` : `guest:${booking.id}`;
        groups.set(key, [...(groups.get(key) ?? []), booking]);
      }
      return [...groups.entries()].map(([id, rows]) => {
        const loyalty = rows[0].clientId ? state.loyalty.get(rows[0].clientId) : undefined;
        const honored = rows.filter((booking) => booking.status === 'honore');
        return {
          id,
          name: rows[0].clientName,
          visits: honored.length,
          note: state.notes.get(id) ?? '',
          points: showMoney ? (loyalty?.points ?? null) : null,
          stamps: showMoney ? (loyalty?.stamps ?? null) : null,
          spentHtCents: showMoney ? honored.reduce((sum, booking) => sum + booking.priceCents, 0) : null,
          history: rows
            .slice()
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((booking) => ({
              date: booking.date,
              serviceName: serviceName(booking.serviceId),
              barberName: barberName(booking.barberId),
              priceLabel: showMoney ? formatCad(booking.totalCents) : null,
              status: booking.status,
            })),
        };
      });
    },
    async saveClientNote(clientId: string, note: string) {
      const user = actor();
      assertCan(user.role, 'clients');
      if (user.role === 'coiffeur') {
        const known = state.bookings.some(
          (booking) => (booking.clientId ? `user:${booking.clientId}` : `guest:${booking.id}`) === clientId && booking.barberId === user.barberId,
        );
        if (!known) {
          throw new AccessDeniedError();
        }
      }
      state.notes.set(clientId, note.trim());
      emit();
    },
    async listStaffReviews(): Promise<Review[]> {
      const user = actor();
      assertCan(user.role, 'reviewsRead');
      return state.reviews.filter((review) => {
        if (user.role === 'proprietaire') {
          return true;
        }
        return review.barberId === user.barberId && review.status === 'publie';
      });
    },
    async moderateReview(reviewId: string, status: Review['status']) {
      const user = actor();
      assertCan(user.role, 'reviewsModerate');
      const review = state.reviews.find((item) => item.id === reviewId);
      if (!review) {
        throw new Error('Avis introuvable.');
      }
      review.status = status;
      emit();
    },
    async listPromos(): Promise<PromoView[]> {
      const user = actor();
      assertCan(user.role, 'promos');
      return state.promos.map((promo) => ({ ...promo }));
    },
    async savePromo(promo: PromoView) {
      const user = actor();
      assertCan(user.role, 'promos');
      const index = state.promos.findIndex((item) => item.code === promo.code);
      const next: PromoCode = { ...promo };
      if (index >= 0) {
        state.promos[index] = next;
      } else {
        state.promos.push(next);
      }
      emit();
    },
    async listTeam(): Promise<TeamMember[]> {
      const user = actor();
      assertCan(user.role, 'team');
      return state.users
        .filter((member) => member.role !== 'client')
        .map((member) => ({
          id: member.id,
          fullName: member.fullName,
          email: member.email,
          role: member.role,
          barberId: member.barberId,
          active: member.active !== false,
        }));
    },
    async setMemberRole(userId: string, role: Account['role']) {
      const user = actor();
      assertCan(user.role, 'team');
      const target = state.users.find((item) => item.id === userId);
      if (!target || target.role === 'client') {
        throw new Error('Membre introuvable.');
      }
      assertLastOwnerSurvives({
        owners: state.users.filter((item) => item.role === 'proprietaire').map((item) => ({ id: item.id, active: item.active !== false })),
        targetId: userId,
        nextActive: target.active !== false,
        nextRole: role,
      });
      target.role = role;
      audit('role', `${target.fullName} → ${role}`);
      emit();
    },
    async setMemberActive(userId: string, active: boolean) {
      const user = actor();
      assertCan(user.role, 'team');
      const target = state.users.find((item) => item.id === userId);
      if (!target) {
        throw new Error('Membre introuvable.');
      }
      if (target.role === 'proprietaire') {
        assertLastOwnerSurvives({
          owners: state.users.filter((item) => item.role === 'proprietaire').map((item) => ({ id: item.id, active: item.active !== false })),
          targetId: userId,
          nextActive: active,
          nextRole: 'proprietaire',
        });
      }
      target.active = active;
      audit(active ? 'reactivation' : 'desactivation', target.fullName);
      emit();
    },
    async inviteMember(payload: { fullName: string; email: string; role: Account['role']; barberId: string | null }) {
      const user = actor();
      assertCan(user.role, 'team');
      if (state.users.some((item) => item.email.toLowerCase() === payload.email.trim().toLowerCase())) {
        throw new Error('Ce courriel a déjà un compte.');
      }
      if (payload.role === 'client') {
        throw new AccessDeniedError();
      }
      if (payload.role === 'coiffeur' && !payload.barberId) {
        throw new Error('Choisis la chaise de ce coiffeur.');
      }
      state.users.push({
        id: crypto.randomUUID(),
        email: payload.email.trim().toLowerCase(),
        password: 'nanometre',
        fullName: payload.fullName.trim(),
        role: payload.role,
        barberId: payload.barberId,
        phone: null,
        active: true,
      });
      audit('invitation', `${payload.fullName.trim()} · ${payload.role} · ${payload.barberId ?? ''}`);
      emit();
      return { invited: true as const };
    },
    async updateSalonSettings(payload: { openMinute: number; closeMinute: number; onsiteLatePolicy: Salon['onsiteLatePolicy'] }) {
      const user = actor();
      assertCan(user.role, 'settings');
      if (payload.closeMinute <= payload.openMinute) {
        throw new Error('L’heure de fermeture doit suivre l’ouverture.');
      }
      state.openMinute = payload.openMinute;
      state.closeMinute = payload.closeMinute;
      state.onsiteLatePolicy = payload.onsiteLatePolicy;
      emit();
    },
    async updateService(serviceId: string, priceCents: number) {
      const user = actor();
      assertCan(user.role, 'services');
      const service = state.services.find((item) => item.id === serviceId);
      if (!service || priceCents < 0) {
        throw new Error('Tarif invalide.');
      }
      service.priceCents = priceCents;
      emit();
    },
    async setBarberWeekday(barberId: string, weekday: number, open: boolean) {
      const user = actor();
      assertCan(user.role, 'barbers');
      const days = new Set(state.schedules.get(barberId) ?? [2, 3, 4, 5, 6]);
      if (open) {
        days.add(weekday);
      } else {
        days.delete(weekday);
      }
      state.schedules.set(barberId, [...days].sort());
      emit();
    },
    async listAudit(): Promise<AuditEntry[]> {
      const user = actor();
      assertCan(user.role, 'team');
      return state.audit;
    },
    weekdays(barberId: string) {
      return state.schedules.get(barberId) ?? [2, 3, 4, 5, 6];
    },
    async barberSetup(): Promise<{ barberId: string; weekdays: number[]; serviceIds: string[] }[]> {
      const user = actor();
      assertCan(user.role, 'barbers');
      const all = state.services.map((service) => service.id);
      return barbers.map((barber) => ({
        barberId: barber.id,
        weekdays: state.schedules.get(barber.id) ?? [2, 3, 4, 5, 6],
        serviceIds: state.eligibility.get(barber.id) ?? all,
      }));
    },
    async setBarberService(barberId: string, serviceId: string, eligible: boolean) {
      const user = actor();
      assertCan(user.role, 'barbers');
      const all = state.services.map((service) => service.id);
      const current = new Set(state.eligibility.get(barberId) ?? all);
      if (eligible) {
        current.add(serviceId);
      } else {
        current.delete(serviceId);
      }
      state.eligibility.set(barberId, [...current]);
      emit();
    },
  };
}

function canLoyalty(role: Account['role']): boolean {
  return role === 'proprietaire';
}
