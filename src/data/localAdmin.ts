import {
  AccessDeniedError,
  applyHonoredVisit,
  assertCan,
  assertLastOwnerSurvives,
  computeDashboard,
  formatCad,
  formatLongDate,
  formatTime,
  mergePromo,
  planBookingNotifications,
  planChangeNotification,
  assertMovableSlot,
  assertSalonHourBounds,
  futureOutsideHours,
  hoursConflictMessage,
  occupancyMinutes,
  periodBounds,
  quotePromo,
  scopeBarber,
  zonedDateTime,
  ARCHIVED_CHAIR_MESSAGE,
  INVALID_WEEKDAY_MESSAGE,
  INVITE_LIMIT_MESSAGE,
  INVITES_PER_HOUR,
  isUpcomingBooking,
  lastWeekdayMessage,
  upcomingWeekdayMessage,
  weekdayOfIso,
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

/** Prestation locale. active absent = active (anciennes sauvegardes). */
export type LocalService = Service & { active?: boolean };

export type CatalogBarber = { id: string; fullName: string; shortName: string; active: boolean };

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
  services: LocalService[];
  reviews: Review[];
  loyalty: Map<string, { points: number; stamps: number; rewardsAvailable: number }>;
  /** Prestations qu'un coiffeur peut faire. Absent = toutes. */
  eligibility: Map<string, string[]>;
  /** Chaises connues, retirées comprises (l’historique garde leur nom). */
  barbers: CatalogBarber[];
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
  emit: () => void;
}) {
  const { state, emit } = input;
  /** F-5 : tentatives d’invitation par propriétaire (heure glissante), comme claim_invite_attempt. */
  const inviteAttempts = new Map<string, number[]>();

  function actor(): Account {
    const user = state.users.find((item) => item.id === state.sessionUserId);
    if (!user || user.active === false) {
      throw new AccessDeniedError();
    }
    return user;
  }

  function barberName(id: string): string {
    return state.barbers.find((barber) => barber.id === id)?.fullName ?? 'Coiffeur';
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
    const scoped = state.barbers.filter((barber) => !barberId || barber.id === barberId);
    const names = new Set(scoped.map((barber) => barber.fullName));
    const { from, to } = periodBounds(anchor, period);
    // Une chaise retirée reste au tableau seulement si elle a travaillé dans la période.
    const listed = scoped.filter(
      (barber) =>
        barber.active ||
        state.bookings.some((booking) => booking.barberId === barber.id && booking.date >= from && booking.date <= to),
    );
    return computeDashboard({
      anchor,
      period,
      includeMoney,
      openSpanMinutes: state.closeMinute - state.openMinute,
      barbers: listed.map((barber) => ({ fullName: barber.fullName })),
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
          serviceId: booking.serviceId,
          durationMinutes: booking.durationMinutes,
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
          serviceId: null,
          durationMinutes: null,
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
    async moveBooking(payload: { bookingId: string; date: string; startMinute: number; now?: Date }) {
      const user = actor();
      assertCan(user.role, 'move');
      const booking = state.bookings.find((item) => item.id === payload.bookingId);
      if (!booking || booking.status !== 'confirme') {
        throw new Error('Ce rendez-vous ne peut pas être déplacé.');
      }
      if (state.barbers.find((item) => item.id === booking.barberId)?.active === false) {
        throw new Error('Ce coiffeur est retiré.');
      }
      if (state.services.find((item) => item.id === booking.serviceId)?.active === false) {
        throw new Error('Cette prestation est retirée.');
      }
      const active = new Set(['confirme', 'honore', 'en_attente_paiement']);
      const busy = state.bookings
        .filter(
          (other) =>
            other.id !== booking.id &&
            other.barberId === booking.barberId &&
            other.date === payload.date &&
            active.has(other.status),
        )
        .map((other) => ({ start: other.startMinute, end: other.startMinute + occupancyMinutes(other.durationMinutes) }));
      const blocked = state.blocks
        .filter((block) => block.barberId === booking.barberId && block.date === payload.date)
        .map((block) => ({ start: block.startMinute, end: block.endMinute }));
      const allowed = state.eligibility.get(booking.barberId);
      assertMovableSlot({
        date: payload.date,
        startMinute: payload.startMinute,
        durationMinutes: booking.durationMinutes,
        openMinute: state.openMinute,
        closeMinute: state.closeMinute,
        openWeekdays: state.schedules.get(booking.barberId) ?? [2, 3, 4, 5, 6],
        eligible: !allowed || allowed.includes(booking.serviceId),
        busy,
        blocked,
        now: payload.now,
      });
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
              id: booking.id,
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
      const code = promo.code.trim().toUpperCase();
      const index = state.promos.findIndex((item) => item.code === code);
      const next = mergePromo(index >= 0 ? state.promos[index] : undefined, { ...promo, code });
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
      if (role === 'coiffeur') {
        if (!target.barberId) {
          throw new Error('Choisis la chaise de ce coiffeur.');
        }
        if (state.barbers.find((item) => item.id === target.barberId)?.active === false) {
          throw new Error(ARCHIVED_CHAIR_MESSAGE);
        }
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
      if (active && target.role === 'coiffeur' && state.barbers.find((item) => item.id === target.barberId)?.active === false) {
        throw new Error(ARCHIVED_CHAIR_MESSAGE);
      }
      target.active = active;
      audit(active ? 'reactivation' : 'desactivation', target.fullName);
      emit();
    },
    async inviteMember(payload: { fullName: string; email: string; role: Account['role']; barberId: string | null }) {
      const user = actor();
      assertCan(user.role, 'team');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(payload.email.trim())) {
        throw new Error('Courriel invalide.');
      }
      if (state.users.some((item) => item.email.toLowerCase() === payload.email.trim().toLowerCase())) {
        throw new Error('Ce courriel a déjà un compte.');
      }
      if (payload.role === 'client') {
        throw new AccessDeniedError();
      }
      if (payload.role === 'coiffeur' && !payload.barberId) {
        throw new Error('Choisis la chaise de ce coiffeur.');
      }
      const now = Date.now();
      const recent = (inviteAttempts.get(user.id) ?? []).filter((at) => now - at < 60 * 60 * 1000);
      if (recent.length >= INVITES_PER_HOUR) {
        inviteAttempts.set(user.id, recent);
        throw new Error(INVITE_LIMIT_MESSAGE);
      }
      inviteAttempts.set(user.id, [...recent, now]);
      if (payload.barberId) {
        const chair = state.barbers.find((item) => item.id === payload.barberId);
        if (!chair) {
          throw new Error('Coiffeur introuvable.');
        }
        if (!chair.active) {
          throw new Error('Ce coiffeur est retiré. Réactive-le avant de l’inviter.');
        }
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
    async updateSalonSettings(payload: { openMinute: number; closeMinute: number; onsiteLatePolicy: Salon['onsiteLatePolicy']; force?: boolean }) {
      const user = actor();
      assertCan(user.role, 'settings');
      assertSalonHourBounds(payload.openMinute, payload.closeMinute);
      const outside = futureOutsideHours(state.bookings, payload.openMinute, payload.closeMinute, new Date()).slice(0, 8);
      if (outside.length > 0 && !payload.force) {
        throw new Error(hoursConflictMessage(outside));
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
      if (!service || !Number.isInteger(priceCents) || priceCents <= 0) {
        throw new Error('Tarif invalide.');
      }
      service.priceCents = priceCents;
      emit();
    },
    async setBarberWeekday(barberId: string, weekday: number, open: boolean) {
      const user = actor();
      assertCan(user.role, 'barbers');
      if (!Number.isInteger(weekday) || weekday < 2 || weekday > 6) {
        throw new Error(INVALID_WEEKDAY_MESSAGE);
      }
      const chair = state.barbers.find((item) => item.id === barberId);
      if (!chair) {
        throw new Error('Coiffeur introuvable.');
      }
      const days = new Set(state.schedules.get(barberId) ?? [2, 3, 4, 5, 6]);
      if (open === days.has(weekday)) {
        return;
      }
      if (open) {
        days.add(weekday);
      } else {
        if (chair.active && ![...days].some((day) => day !== weekday && day >= 2 && day <= 6)) {
          throw new Error(lastWeekdayMessage(chair.shortName));
        }
        const now = new Date();
        const upcoming = state.bookings.filter(
          (booking) =>
            booking.barberId === barberId &&
            weekdayOfIso(booking.date) === weekday &&
            isUpcomingBooking({ status: booking.status, endsAt: zonedDateTime(booking.date, booking.startMinute + booking.durationMinutes) }, now),
        ).length;
        if (upcoming > 0) {
          throw new Error(upcomingWeekdayMessage(chair.shortName, upcoming, weekday));
        }
        days.delete(weekday);
      }
      state.schedules.set(barberId, [...days].sort());
      auditEntry(state, 'coiffeur_jour', `${chair.fullName} · ${weekday} · ${open ? 'travaille' : 'congé'}`);
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
      return state.barbers.map((barber) => ({
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
        if (state.services.find((service) => service.id === serviceId)?.active === false) {
          throw new Error('Cette prestation est retirée.');
        }
        current.add(serviceId);
      } else {
        const chair = state.barbers.find((item) => item.id === barberId);
        const remaining = state.services.filter((service) => service.active !== false && service.id !== serviceId && current.has(service.id));
        if (chair?.active !== false && remaining.length === 0) {
          throw new Error('Un coiffeur actif doit garder au moins une prestation.');
        }
        current.delete(serviceId);
      }
      state.eligibility.set(barberId, [...current]);
      emit();
    },
  };
}

export function auditEntry(state: Pick<AdminState, 'audit'>, action: string, detail: string) {
  state.audit.unshift({ id: crypto.randomUUID(), action, detail, at: new Date().toISOString() });
}

function canLoyalty(role: Account['role']): boolean {
  return role === 'proprietaire';
}
