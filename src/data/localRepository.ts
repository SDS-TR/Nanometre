import {
  computeLineTaxes,
  CUTS_PER_REWARD,
  emptyLoyalty,
  generateSlots,
  holdExpired,
  isOpenWeekday,
  assertLastOwnerSurvives,
  assertCan,
  AccessDeniedError,
  isUpcomingBooking,
  orphanServiceMessage,
  reactivateServiceWithoutBarberMessage,
  reactivateWithoutServiceMessage,
  reactivateWithoutWeekdayMessage,
  quoteCancellation,
  uniqueSlug,
  upcomingBarberMessage,
  upcomingServiceMessage,
  validateNewBarber,
  validateNewService,
  restoreReward,
  type PromoCode,
  weekdayOfIso,
  demoRebaseDays,
  defaultSalonWeek,
  dayHoursLabel,
  futureOutsideWeek,
  hoursConflictMessage,
  salonDayHours,
  validateSalonWeek,
  weekdayLong,
  type SalonDay,
  formatCad,
  formatLongDate,
  formatTime,
  occupancyMinutes,
  REASSIGN_TARGET_MESSAGE,
  validateServiceDetails,
  rebaseIso,
  zonedDateTime,
  zonedParts,
  type BookingLifecycle,
  type LoyaltyState,
  type PaymentMethod,
  type PaymentStatus,
} from '../domain';
import { maskClientName } from '../lib/privacy';
import { auditEntry, createAdmin, defaultPromos, type BlockSlot, type LocalService, type StoredNotification } from './localAdmin';
import seed from './seed.normalized.json';
import type { KeyValueStore } from './storage';
import type {
  Account,
  Barber,
  BookingRecord,
  BookingView,
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

const STORAGE_KEY = 'lenanometre.delta.v2';
const DEMO_LATE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ACTIVE = new Set(['en_attente_paiement', 'confirme', 'honore']);
const ALL_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

/** Chaise locale. active = false : retirée, cachée des réservations, gardée pour l’historique. */
/** Changement de prix d’une prestation (historique visible par le propriétaire). */
export type PriceChange = { id: string; serviceId: string; oldCents: number; newCents: number; at: string };

type LocalBarber = Omit<Barber, 'serviceIds'> & { active: boolean };

type Delta = {
  sessionUserId: string | null;
  users: Account[];
  staffPatches: { id: string; role: Account['role']; active: boolean; barberId: string | null }[];
  bookingPatches: BookingRecord[];
  loyaltyPatches: { clientId: string; points: number; stamps: number; rewardsAvailable: number }[];
  reviewPatches: Review[];
  blocks: BlockSlot[];
  notes: [string, string][];
  promos: PromoCode[];
  openMinute: number;
  closeMinute: number;
  onsiteLatePolicy: 'aucun' | 'a_la_prochaine';
  schedules: [string, number[]][];
  notifications: StoredNotification[];
  optIn: string[];
  audit: { id: string; action: string; detail: string; at: string }[];
  servicePrices: { id: string; priceCents: number }[];
  eligibility?: [string, string[]][];
  pushTokens?: [string, string][];
  deletedUserIds?: string[];
  addedBarbers?: LocalBarber[];
  archivedBarberIds?: string[];
  addedServices?: Service[];
  archivedServiceIds?: string[];
  /** Décalage (jours) du seed quand ce delta a été écrit. Absent = 0 (avant le 12 octobre). */
  rebaseDays?: number;
  /** Nom, description et durée modifiés après coup. */
  serviceDetails?: { id: string; name: string; description: string; durationMinutes: number }[];
  priceHistory?: PriceChange[];
  salonWeek?: SalonDay[];
};

type State = {
  sessionUserId: string | null;
  users: Account[];
  bookings: BookingRecord[];
  loyalty: Map<string, LoyaltyState>;
  reviews: Review[];
  pendingMagicEmail: string | null;
  blocks: BlockSlot[];
  notes: Map<string, string>;
  promos: PromoCode[];
  openMinute: number;
  closeMinute: number;
  onsiteLatePolicy: 'aucun' | 'a_la_prochaine';
  schedules: Map<string, number[]>;
  notifications: StoredNotification[];
  optIn: Set<string>;
  audit: { id: string; action: string; detail: string; at: string }[];
  services: LocalService[];
  eligibility: Map<string, string[]>;
  pushTokens: Map<string, string>;
  barbers: LocalBarber[];
  priceHistory: PriceChange[];
  /** Horaires du salon, jour par jour. Défaut : 7 jours sur 7, 0 h à 24 h. */
  salonWeek: SalonDay[];
};

function cloneSeed(rebase = 0): State {
  const users: Account[] = seed.users.map((user) => ({
    id: user.id,
    email: user.email,
    password: user.password,
    fullName: user.fullName,
    role: user.role as Account['role'],
    barberId: user.barberId,
    phone: user.phone,
  }));
  const loyalty = new Map<string, LoyaltyState>();
  for (const row of seed.loyalty) {
    loyalty.set(row.clientId, {
      points: row.points,
      stamps: row.stamps,
      rewardsAvailable: row.rewardsAvailable,
    });
  }
  return {
    sessionUserId: null,
    users,
    bookings: seed.bookings.map(
      (booking): BookingRecord => ({
        ...booking,
        date: rebaseIso(booking.date, rebase),
        paymentMethod: booking.paymentMethod as PaymentMethod,
        status: booking.status as BookingLifecycle,
        paymentStatus: booking.paymentStatus as PaymentStatus,
      }),
    ),
    loyalty,
    reviews: seed.reviews.map(
      (review): Review => ({
        ...review,
        date: rebaseIso(review.date, rebase),
        status: review.status as Review['status'],
      }),
    ),
    pendingMagicEmail: null,
    blocks: [],
    notes: new Map(),
    promos: defaultPromos().map((promo) => ({ ...promo, startsOn: rebaseIso(promo.startsOn, rebase), endsOn: rebaseIso(promo.endsOn, rebase) })),
    openMinute: seed.salon.openMinute,
    closeMinute: seed.salon.closeMinute,
    onsiteLatePolicy: 'aucun',
    schedules: new Map(seed.barbers.map((barber) => [barber.id, [0, 1, 2, 3, 4, 5, 6]])),
    notifications: [],
    optIn: new Set(),
    audit: [],
    services: seed.services.map((service) => ({ ...service, active: true })) as LocalService[],
    eligibility: new Map(),
    pushTokens: new Map(),
    barbers: seed.barbers.map((barber) => ({ ...barber, active: true })),
    priceHistory: [],
    salonWeek: defaultSalonWeek(),
  };
}

/** Glisse les dates d’un ancien delta quand la semaine de démo change. */
function slideDelta(delta: Delta, days: number): Delta {
  if (days === 0) {
    return delta;
  }
  const move = (iso: string) => rebaseIso(iso, days);
  return {
    ...delta,
    bookingPatches: delta.bookingPatches.map((booking) => ({ ...booking, date: move(booking.date) })),
    reviewPatches: delta.reviewPatches.map((review) => ({ ...review, date: move(review.date) })),
    blocks: (delta.blocks ?? []).map((block) => ({ ...block, date: move(block.date) })),
    promos: (delta.promos ?? []).map((promo) => ({ ...promo, startsOn: move(promo.startsOn), endsOn: move(promo.endsOn) })),
  };
}

function publicUser(user: Account): SessionUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    barberId: user.barberId,
    phone: user.phone,
  };
}

function releaseExpiredHolds(state: State, now = new Date()) {
  for (const booking of state.bookings) {
    if (booking.status !== 'en_attente_paiement' || !holdExpired(booking.createdAt, now)) {
      continue;
    }
    booking.status = 'annule';
    booking.paymentStatus = 'echoue';
    if (booking.promoCode) {
      const promo = state.promos.find((item) => item.code === booking.promoCode);
      if (promo && promo.usageCount > 0) {
        promo.usageCount -= 1;
      }
      booking.promoCode = null;
    }
  }
}

function busyFor(state: State, barberId: string, date: string) {
  const bookings = state.bookings
    .filter((booking) => booking.barberId === barberId && booking.date === date && ACTIVE.has(booking.status))
    .map((booking) => ({ start: booking.startMinute, end: booking.startMinute + booking.durationMinutes }));
  const blocks = state.blocks
    .filter((block) => block.barberId === barberId && block.date === date)
    .map((block) => ({ start: block.startMinute, end: block.endMinute }));
  return [...bookings, ...blocks];
}

function present(state: State, booking: BookingRecord): BookingView {
  const barber = state.barbers.find((item) => item.id === booking.barberId);
  const service = state.services.find((item) => item.id === booking.serviceId);
  return {
    ...booking,
    barberName: barber?.fullName ?? 'Coiffeur',
    serviceName: service?.name ?? 'Prestation',
    barberPhoto: barber?.photo ?? 'hero',
    servicePhoto: service?.photo ?? 'hero',
  };
}

function ensureLoyalty(state: State, clientId: string): LoyaltyState {
  const current = state.loyalty.get(clientId);
  if (current) {
    return current;
  }
  const created = emptyLoyalty();
  state.loyalty.set(clientId, created);
  return created;
}

function placeDemoLateCancel(state: State, now: Date) {
  const alex = state.users.find((user) => user.email === 'alex.gagnon@exemple.ca');
  if (!alex) {
    return;
  }
  const existing = state.bookings.find((booking) => booking.id === DEMO_LATE_ID);
  if (existing) {
    const when = zonedDateTime(existing.date, existing.startMinute);
    const delta = when.getTime() - now.getTime();
    if (existing.status === 'confirme' && delta > 15 * 60 * 1000 && delta < 24 * 60 * 60 * 1000) {
      return;
    }
    state.bookings = state.bookings.filter((booking) => booking.id !== DEMO_LATE_ID);
  }
  const future = state.bookings.some((booking) => {
    if (booking.clientId !== alex.id || booking.status !== 'confirme') {
      return false;
    }
    const delta = zonedDateTime(booking.date, booking.startMinute).getTime() - now.getTime();
    return delta > 0 && delta < 24 * 60 * 60 * 1000;
  });
  if (future) {
    return;
  }
  const service = state.services.find((item) => item.slug === 'coupe-classique' && item.active !== false);
  const barber = state.barbers.find((item) => item.slug === 'karim-b' && item.active);
  if (!service || !barber) {
    return;
  }
  const today = zonedParts(now).isoDate;
  for (let offset = 0; offset < 4; offset += 1) {
    const date = shift(today, offset);
    if (!isOpenWeekday(weekdayOfIso(date), state.salonWeek)) {
      continue;
    }
    const slots = generateSlots({
      weekday: weekdayOfIso(date),
      durationMinutes: service.durationMinutes,
      busy: busyFor(state, barber.id, date),
      earliestStartMinute: date === today ? zonedParts(now).minuteOfDay + 15 : undefined,
      openMinute: state.openMinute,
      closeMinute: state.closeMinute,
      week: state.salonWeek,
    });
    const slot = slots.find((item) => {
      if (!item.available) {
        return false;
      }
      const delta = zonedDateTime(date, item.startMinute).getTime() - now.getTime();
      return delta > 30 * 60 * 1000 && delta < 24 * 60 * 60 * 1000;
    });
    if (!slot) {
      continue;
    }
    const taxes = computeLineTaxes(service.priceCents);
    state.bookings.push({
      id: DEMO_LATE_ID,
      clientId: alex.id,
      clientName: alex.fullName,
      barberId: barber.id,
      serviceId: service.id,
      date,
      startMinute: slot.startMinute,
      durationMinutes: service.durationMinutes,
      priceCents: taxes.subtotalCents,
      gstCents: taxes.gstCents,
      qstCents: taxes.qstCents,
      totalCents: taxes.totalCents,
      paymentMethod: 'en_ligne',
      status: 'confirme',
      paymentStatus: 'paye',
      refundedCents: 0,
      feeCents: 0,
      feeGstCents: 0,
      feeQstCents: 0,
      feeHtCents: 0,
      loyaltyRedeemed: false,
    });
    return;
  }
}

function shift(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

function applyDelta(state: State, delta: Delta) {
  const known = new Set(state.users.map((user) => user.id));
  for (const user of delta.users) {
    if (!known.has(user.id)) {
      state.users.push(user);
    } else {
      const index = state.users.findIndex((item) => item.id === user.id);
      state.users[index] = { ...state.users[index], ...user, password: state.users[index].password };
    }
  }
  for (const patch of delta.bookingPatches) {
    const index = state.bookings.findIndex((item) => item.id === patch.id);
    if (index >= 0) {
      state.bookings[index] = patch;
    } else {
      state.bookings.push(patch);
    }
  }
  for (const row of delta.loyaltyPatches) {
    state.loyalty.set(row.clientId, {
      points: row.points,
      stamps: row.stamps,
      rewardsAvailable: row.rewardsAvailable,
    });
  }
  for (const review of delta.reviewPatches) {
    if (!state.reviews.some((item) => item.id === review.id)) {
      state.reviews.push(review);
    }
  }
  for (const id of delta.deletedUserIds ?? []) {
    state.users = state.users.filter((user) => user.id !== id);
    state.loyalty.delete(id);
  }
  if (delta.sessionUserId && state.users.some((user) => user.id === delta.sessionUserId)) {
    state.sessionUserId = delta.sessionUserId;
  }
  for (const patch of delta.staffPatches ?? []) {
    const user = state.users.find((item) => item.id === patch.id);
    if (user) {
      user.role = patch.role;
      user.active = patch.active;
      user.barberId = patch.barberId;
    }
  }
  state.blocks = delta.blocks ?? [];
  state.notes = new Map(delta.notes ?? []);
  if (delta.promos?.length) {
    state.promos = delta.promos;
  }
  state.openMinute = delta.openMinute ?? state.openMinute;
  state.closeMinute = delta.closeMinute ?? state.closeMinute;
  state.onsiteLatePolicy = delta.onsiteLatePolicy ?? state.onsiteLatePolicy;
  if (delta.schedules) {
    state.schedules = new Map(delta.schedules);
  }
  state.notifications = delta.notifications ?? [];
  state.optIn = new Set(delta.optIn ?? []);
  state.audit = delta.audit ?? [];
  for (const service of delta.addedServices ?? []) {
    if (!state.services.some((item) => item.id === service.id)) {
      state.services.push({ ...service, active: true });
    }
  }
  const archivedServices = new Set(delta.archivedServiceIds ?? []);
  for (const service of state.services) {
    service.active = !archivedServices.has(service.id);
  }
  for (const barber of delta.addedBarbers ?? []) {
    if (!state.barbers.some((item) => item.id === barber.id)) {
      state.barbers.push({ ...barber, active: true });
    }
  }
  const archivedBarbers = new Set(delta.archivedBarberIds ?? []);
  for (const barber of state.barbers) {
    barber.active = !archivedBarbers.has(barber.id);
  }
  for (const detail of delta.serviceDetails ?? []) {
    const service = state.services.find((item) => item.id === detail.id);
    if (service) {
      service.name = detail.name;
      service.description = detail.description;
      service.durationMinutes = detail.durationMinutes;
    }
  }
  state.priceHistory = delta.priceHistory ?? [];
  state.salonWeek = delta.salonWeek ?? defaultSalonWeek();
  for (const price of delta.servicePrices ?? []) {
    const service = state.services.find((item) => item.id === price.id);
    if (service) {
      service.priceCents = price.priceCents;
    }
  }
  if (delta.eligibility) {
    state.eligibility = new Map(delta.eligibility);
  }
  if (delta.pushTokens) {
    state.pushTokens = new Map(delta.pushTokens);
  }
}

export function createLocalRepository(storage: KeyValueStore, options: { now?: () => Date } = {}): Repository {
  const clock = options.now ?? (() => new Date());
  // Bogue 1 (revue du 12 oct.) : le seed suit la date du jour, à la semaine près.
  const rebase = demoRebaseDays(zonedParts(clock()).isoDate);
  const state = cloneSeed(rebase);
  const seedBookings = new Map(cloneSeed(rebase).bookings.map((booking) => [booking.id, JSON.stringify(booking)]));
  const seedServices = new Map(seed.services.map((service) => [service.id, service]));
  const listeners = new Set<() => void>();

  const ready = (async () => {
    const raw = await storage.getItem(STORAGE_KEY);
    if (raw) {
      const delta = JSON.parse(raw) as Delta;
      applyDelta(state, slideDelta(delta, rebase - (delta.rebaseDays ?? 0)));
    }
    placeDemoLateCancel(state, clock());
    await persist();
  })();

  async function persist() {
    const seedLoyalty = new Map(seed.loyalty.map((row) => [row.clientId, JSON.stringify(row)]));
    const delta: Delta = {
      sessionUserId: state.sessionUserId,
      users: state.users.filter((user) => !seed.users.some((item) => item.id === user.id)),
      staffPatches: state.users
        .filter((user) => seed.users.some((item) => item.id === user.id))
        .filter((user) => {
          const original = seed.users.find((item) => item.id === user.id);
          return original && (original.role !== user.role || user.active === false || original.barberId !== user.barberId);
        })
        .map((user) => ({ id: user.id, role: user.role, active: user.active !== false, barberId: user.barberId })),
      bookingPatches: state.bookings.filter((booking) => seedBookings.get(booking.id) !== JSON.stringify(booking)),
      loyaltyPatches: [...state.loyalty.entries()]
        .filter(([clientId, value]) => seedLoyalty.get(clientId) !== JSON.stringify({ clientId, ...value }))
        .map(([clientId, value]) => ({ clientId, ...value })),
      reviewPatches: state.reviews.filter((review) => !seed.reviews.some((item) => item.id === review.id)),
      blocks: state.blocks,
      notes: [...state.notes.entries()],
      promos: state.promos,
      openMinute: state.openMinute,
      closeMinute: state.closeMinute,
      onsiteLatePolicy: state.onsiteLatePolicy,
      schedules: [...state.schedules.entries()],
      notifications: state.notifications,
      optIn: [...state.optIn],
      audit: state.audit,
      servicePrices: state.services.map((service) => ({ id: service.id, priceCents: service.priceCents })),
      eligibility: [...state.eligibility.entries()],
      pushTokens: [...state.pushTokens.entries()],
      deletedUserIds: seed.users.filter((user) => !state.users.some((item) => item.id === user.id)).map((user) => user.id),
      addedBarbers: state.barbers.filter((barber) => !seed.barbers.some((item) => item.id === barber.id)),
      archivedBarberIds: state.barbers.filter((barber) => !barber.active).map((barber) => barber.id),
      addedServices: state.services
        .filter((service) => !seed.services.some((item) => item.id === service.id))
        .map(({ active: _active, ...service }) => service),
      archivedServiceIds: state.services.filter((service) => service.active === false).map((service) => service.id),
      rebaseDays: rebase,
      serviceDetails: state.services
        .filter((service) => {
          const original = seedServices.get(service.id);
          return (
            original &&
            (original.name !== service.name || original.description !== service.description || original.durationMinutes !== service.durationMinutes)
          );
        })
        .map((service) => ({ id: service.id, name: service.name, description: service.description, durationMinutes: service.durationMinutes })),
      priceHistory: state.priceHistory,
      salonWeek: state.salonWeek,
    };
    await storage.setItem(STORAGE_KEY, JSON.stringify(delta));
  }

  function emit() {
    listeners.forEach((listener) => listener());
    void persist();
  }

  function requireUser(): Account {
    const user = state.users.find((item) => item.id === state.sessionUserId);
    if (!user) {
      throw new Error('Connecte-toi pour continuer.');
    }
    return user;
  }

  function findAccount(email: string): Account | undefined {
    return state.users.find((user) => user.email.toLowerCase() === email.trim().toLowerCase());
  }

  const admin = createAdmin({ state, emit });

  function requireOwner(action: 'barbers' | 'services'): Account {
    const user = state.users.find((item) => item.id === state.sessionUserId);
    if (!user || user.active === false) {
      throw new AccessDeniedError();
    }
    assertCan(user.role, action);
    if (user.role !== 'proprietaire') {
      throw new AccessDeniedError();
    }
    return user;
  }

  function upcomingCount(match: (booking: BookingRecord) => boolean, now = new Date()): number {
    return state.bookings.filter(
      (booking) =>
        match(booking) &&
        isUpcomingBooking({ status: booking.status, endsAt: zonedDateTime(booking.date, booking.startMinute + booking.durationMinutes) }, now),
    ).length;
  }

  function offeredBy(barberId: string): string[] {
    return state.eligibility.get(barberId) ?? state.services.map((service) => service.id);
  }

  function activeServiceIds(): Set<string> {
    return new Set(state.services.filter((service) => service.active !== false).map((service) => service.id));
  }

  const repository: Repository = {
    mode: 'local',
    ready,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSession() {
      const user = state.users.find((item) => item.id === state.sessionUserId);
      return user ? publicUser(user) : null;
    },
    async signIn(email, password) {
      await ready;
      const user = findAccount(email);
      if (!user || user.password !== password) {
        throw new Error('Courriel ou mot de passe incorrect.');
      }
      if (user.active === false) {
        throw new Error('Ce compte est désactivé.');
      }
      state.sessionUserId = user.id;
      emit();
      return publicUser(user);
    },
    async signUp({ fullName, email, password }) {
      await ready;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
        throw new Error('Courriel invalide.');
      }
      if (password.length < 8) {
        throw new Error('Le mot de passe doit contenir au moins 8 caractères.');
      }
      if (findAccount(email)) {
        throw new Error('Un compte existe déjà avec ce courriel.');
      }
      const user: Account = {
        id: crypto.randomUUID(),
        email: email.trim().toLowerCase(),
        password,
        fullName: fullName.trim(),
        role: 'client',
        barberId: null,
        phone: null,
      };
      if (!user.fullName) {
        throw new Error('Indique ton nom.');
      }
      state.users.push(user);
      state.loyalty.set(user.id, emptyLoyalty());
      state.sessionUserId = user.id;
      emit();
      return publicUser(user);
    },
    async sendMagicLink(email) {
      await ready;
      const user = findAccount(email);
      if (!user) {
        throw new Error('Aucun compte pour ce courriel.');
      }
      state.pendingMagicEmail = user.email;
      return { demo: true };
    },
    async completeMagicLink(email) {
      await ready;
      const user = findAccount(email);
      if (!user || state.pendingMagicEmail !== user.email) {
        throw new Error('Ce lien n’est plus valide.');
      }
      state.pendingMagicEmail = null;
      state.sessionUserId = user.id;
      emit();
      return publicUser(user);
    },
    async signOut() {
      await ready;
      state.sessionUserId = null;
      emit();
    },
    async requestAccountDeletion(email: string) {
      const trimmed = email.trim();
      if (!trimmed.includes('@')) {
        throw new Error('Courriel invalide.');
      }
    },
    async deleteAccount(confirmation) {
      await ready;
      if (confirmation !== 'SUPPRIMER') {
        throw new Error('Écris SUPPRIMER pour confirmer.');
      }
      const user = requireUser();
      if (user.role === 'proprietaire') {
        assertLastOwnerSurvives({
          owners: state.users.filter((item) => item.role === 'proprietaire').map((item) => ({ id: item.id, active: item.active !== false })),
          targetId: user.id,
          nextActive: false,
          nextRole: 'client',
        });
      }
      const now = new Date();
      for (const booking of state.bookings) {
        if (booking.clientId !== user.id) {
          continue;
        }
        const upcoming = zonedDateTime(booking.date, booking.startMinute) > now && (booking.status === 'confirme' || booking.status === 'en_attente_paiement');
        if (upcoming) {
          booking.status = 'annule';
          booking.paymentStatus = booking.paymentStatus === 'paye' ? 'rembourse' : 'echoue';
        }
        booking.clientId = null;
        booking.clientName = 'Client supprimé';
      }
      for (const review of state.reviews) {
        if (review.clientName === user.fullName) {
          review.clientName = 'Client';
        }
      }
      state.loyalty.delete(user.id);
      state.notes.delete(user.id);
      state.notes.delete(`user:${user.id}`);
      state.users = state.users.filter((item) => item.id !== user.id);
      state.sessionUserId = null;
      emit();
    },
    async updateProfile({ fullName, phone }) {
      await ready;
      const user = requireUser();
      user.fullName = fullName.trim();
      user.phone = phone;
      for (const booking of state.bookings) {
        if (booking.clientId === user.id) {
          booking.clientName = user.fullName;
        }
      }
      emit();
      return publicUser(user);
    },
    async getSalon() {
      await ready;
      return {
        ...seed.salon,
        openMinute: state.openMinute,
        closeMinute: state.closeMinute,
        week: state.salonWeek.map((day) => ({ ...day })),
        onsiteLatePolicy: state.onsiteLatePolicy,
        minAppVersion: '1.0.0',
      };
    },
    async getBarbers() {
      await ready;
      const all = state.services.map((service) => service.id);
      return state.barbers
        .filter((barber) => barber.active)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(({ active: _active, ...barber }) => {
          const published = state.reviews.filter((review) => review.barberId === barber.id && review.status === 'publie');
          const rating = published.length === 0 ? 0 : Math.round((published.reduce((sum, review) => sum + review.stars, 0) / published.length) * 10) / 10;
          return { ...barber, serviceIds: state.eligibility.get(barber.id) ?? all, rating, reviewCount: published.length };
        });
    },
    async getServices() {
      await ready;
      return state.services
        .filter((service) => service.active !== false)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map(({ active: _active, ...service }) => service);
    },
    async getReviews(barberId) {
      await ready;
      return state.reviews
        .filter((review) => review.barberId === barberId && review.status === 'publie')
        .map((review) => ({ ...review, clientName: maskClientName(review.clientName) }));
    },
    async getSlots({ barberId, serviceId, date, now = new Date() }) {
      await ready;
      releaseExpiredHolds(state, now);
      const service = state.services.find((item) => item.id === serviceId && item.active !== false);
      if (!service) {
        throw new Error('Prestation introuvable.');
      }
      const weekday = weekdayOfIso(date);
      const today = zonedParts(now);
      const earliest = date === today.isoDate ? today.minuteOfDay + 1 : undefined;
      const inactive = new Set(
        state.users.filter((user) => user.role === 'coiffeur' && user.active === false && user.barberId).map((user) => user.barberId as string),
      );
      const offers = (id: string) => {
        const allowed = state.eligibility.get(id);
        return !allowed || allowed.includes(serviceId);
      };
      const bookable = (id: string) => !inactive.has(id) && offers(id) && (state.schedules.get(id) ?? []).includes(weekday);
      const chairs = state.barbers.filter((barber) => barber.active);
      const candidates =
        barberId === 'any'
          ? [...chairs]
              .filter((barber) => bookable(barber.id))
              .sort((a, b) => busyFor(state, a.id, date).length - busyFor(state, b.id, date).length)
          : chairs.filter((item) => item.id === barberId && bookable(item.id));
      const grid = generateSlots({
        weekday,
        durationMinutes: service.durationMinutes,
        earliestStartMinute: earliest,
        openMinute: state.openMinute,
        closeMinute: state.closeMinute,
        week: state.salonWeek,
      });
      const merged: SlotView[] = grid.map((slot) => ({
        startMinute: slot.startMinute,
        endMinute: slot.endMinute,
        available: false,
        barberId: null,
      }));
      for (const barber of candidates) {
        const slots = generateSlots({
          weekday,
          durationMinutes: service.durationMinutes,
          busy: busyFor(state, barber.id, date),
          earliestStartMinute: earliest,
          openMinute: state.openMinute,
          closeMinute: state.closeMinute,
          week: state.salonWeek,
        });
        slots.forEach((slot, index) => {
          if (slot.available && !merged[index].available) {
            merged[index] = {
              startMinute: slot.startMinute,
              endMinute: slot.endMinute,
              available: true,
              barberId: barber.id,
            };
          }
        });
      }
      return merged;
    },
    async getMyBookings() {
      await ready;
      const user = state.users.find((item) => item.id === state.sessionUserId);
      if (!user) {
        return [];
      }
      return state.bookings
        .filter((booking) => booking.clientId === user.id)
        .map((booking) => present(state, booking))
        .sort((a, b) => zonedDateTime(a.date, a.startMinute).getTime() - zonedDateTime(b.date, b.startMinute).getTime());
    },
    async getBooking(id) {
      await ready;
      const booking = state.bookings.find((item) => item.id === id);
      if (!booking) {
        throw new Error('Rendez-vous introuvable.');
      }
      return present(state, booking);
    },
    async createBooking(input) {
      await ready;
      const user = requireUser();
      const service = state.services.find((item) => item.id === input.serviceId);
      const barber = state.barbers.find((item) => item.id === input.barberId);
      if (!service || !barber) {
        throw new Error('Choix incomplet.');
      }
      if (service.active === false) {
        throw new Error('Prestation introuvable.');
      }
      if (!barber.active) {
        throw new Error('Ce coiffeur est inactif.');
      }
      const staff = state.users.find((item) => item.role === 'coiffeur' && item.barberId === input.barberId);
      if (staff?.active === false) {
        throw new Error('Ce coiffeur est inactif.');
      }
      if (!(state.schedules.get(input.barberId) ?? []).includes(weekdayOfIso(input.date))) {
        throw new Error('Ce coiffeur ne travaille pas ce jour-là.');
      }
      const slots = await repository.getSlots({
        barberId: input.barberId,
        serviceId: input.serviceId,
        date: input.date,
      });
      const slot = slots.find((item) => item.startMinute === input.startMinute && item.available);
      if (!slot) {
        throw new Error('Ce créneau n’est plus libre.');
      }
      let price = service.priceCents;
      let promoCode: string | null = null;
      let discountCents = 0;
      if (input.promoCode && !input.redeemReward) {
        const quote = admin.quotePromo(input.promoCode, input.date, price);
        promoCode = quote.code;
        discountCents = quote.discountCents;
        price -= discountCents;
        admin.consumePromo(promoCode);
      }
      if (input.redeemReward) {
        const loyalty = ensureLoyalty(state, user.id);
        if (loyalty.rewardsAvailable < 1) {
          throw new Error('Aucune coupe offerte à utiliser.');
        }
        loyalty.rewardsAvailable -= 1;
        price = 0;
      }
      const taxes = computeLineTaxes(price);
      const offered = taxes.totalCents === 0;
      const booking: BookingRecord = {
        id: crypto.randomUUID(),
        clientId: user.id,
        clientName: user.fullName,
        barberId: barber.id,
        serviceId: service.id,
        date: input.date,
        startMinute: input.startMinute,
        durationMinutes: service.durationMinutes,
        priceCents: taxes.subtotalCents,
        gstCents: taxes.gstCents,
        qstCents: taxes.qstCents,
        totalCents: taxes.totalCents,
        paymentMethod: input.paymentMethod,
        status: offered || input.paymentMethod !== 'en_ligne' ? 'confirme' : 'en_attente_paiement',
        paymentStatus: offered || input.paymentMethod !== 'en_ligne' ? 'a_encaisser' : 'en_attente',
        refundedCents: 0,
        feeCents: 0,
        feeGstCents: 0,
        feeQstCents: 0,
        feeHtCents: 0,
        loyaltyRedeemed: input.redeemReward,
        promoCode,
        discountCents,
        createdAt: new Date().toISOString(),
        feeOwingCents: 0,
      };
      state.bookings.push(booking);
      if (booking.status === 'confirme') {
        admin.notifyConfirmed(booking);
      }
      emit();
      return present(state, booking);
    },
    async markPaid(bookingId) {
      await ready;
      const user = requireUser();
      const booking = state.bookings.find((item) => item.id === bookingId && item.clientId === user.id);
      if (!booking || booking.status !== 'en_attente_paiement') {
        throw new Error('Ce paiement ne peut pas être confirmé.');
      }
      booking.status = 'confirme';
      booking.paymentStatus = 'paye';
      booking.paymentMethod = 'en_ligne';
      admin.notifyConfirmed(booking);
      emit();
      return present(state, booking);
    },
    async confirmOnSite(bookingId) {
      await ready;
      const user = requireUser();
      const booking = state.bookings.find((item) => item.id === bookingId && item.clientId === user.id);
      if (!booking || booking.status !== 'en_attente_paiement' || booking.paymentStatus === 'paye') {
        throw new Error('Ce rendez-vous est déjà payé en ligne.');
      }
      booking.paymentMethod = 'sur_place';
      booking.status = 'confirme';
      booking.paymentStatus = 'a_encaisser';
      admin.notifyConfirmed(booking);
      emit();
      return present(state, booking);
    },
    async abandonCheckout(bookingId) {
      await ready;
      const user = requireUser();
      const booking = state.bookings.find((item) => item.id === bookingId && item.clientId === user.id);
      if (!booking || booking.status !== 'en_attente_paiement') {
        return;
      }
      if (booking.loyaltyRedeemed) {
        const loyalty = ensureLoyalty(state, user.id);
        state.loyalty.set(user.id, restoreReward(loyalty));
      }
      admin.releasePromo(booking.promoCode);
      state.bookings = state.bookings.filter((item) => item.id !== bookingId);
      emit();
    },
    async cancelBooking(bookingId, now = new Date()) {
      await ready;
      const user = requireUser();
      const booking = state.bookings.find((item) => item.id === bookingId && item.clientId === user.id);
      if (!booking) {
        throw new Error('Rendez-vous introuvable.');
      }
      const quote = quoteCancellation({
        startsAt: zonedDateTime(booking.date, booking.startMinute),
        now,
        preTaxCents: booking.priceCents,
        totalCents: booking.totalCents,
        paymentMethod: booking.paymentMethod,
        paymentStatus: booking.paymentStatus,
        status: booking.status,
        gstNumber: seed.salon.gstNumber,
        qstNumber: seed.salon.qstNumber,
        taxNumbersPlaceholder: seed.salon.taxNumbersPlaceholder,
        onsiteLatePolicy: state.onsiteLatePolicy,
      });
      if (!quote.allowed) {
        throw new Error(quote.reason === 'deja_annule' ? 'Ce rendez-vous est déjà annulé.' : 'Ce rendez-vous ne peut plus être annulé.');
      }
      booking.status = quote.feeApplies ? 'annule_tardif' : 'annule';
      booking.refundedCents = quote.refundCents;
      booking.feeCents = quote.feeCents;
      booking.feeGstCents = quote.extraction?.gstCents ?? 0;
      booking.feeQstCents = quote.extraction?.qstCents ?? 0;
      booking.feeHtCents = quote.feeApplies ? (quote.extraction?.netCents ?? 0) : 0;
      booking.feeOwingCents = quote.feeOwingCents;
      if (quote.feeApplies) {
        booking.paymentStatus = 'rembourse_partiel';
      } else if (booking.paymentStatus === 'paye') {
        booking.paymentStatus = 'rembourse';
      } else {
        booking.paymentStatus = 'echoue';
      }
      if (booking.loyaltyRedeemed) {
        state.loyalty.set(user.id, restoreReward(ensureLoyalty(state, user.id)));
        booking.loyaltyRedeemed = false;
      }
      admin.notifyChange(booking, 'annulation', `Ton rendez-vous du ${booking.date} est annulé.`);
      emit();
      return present(state, booking);
    },
    async getLoyalty() {
      await ready;
      const user = requireUser();
      const loyalty = ensureLoyalty(state, user.id);
      const view: LoyaltyView = { ...loyalty, cutsPerReward: CUTS_PER_REWARD };
      return view;
    },
    async submitReview({ bookingId, stars, body }) {
      await ready;
      const user = requireUser();
      const booking = state.bookings.find((item) => item.id === bookingId && item.clientId === user.id);
      if (!booking || booking.status !== 'honore') {
        throw new Error('Tu pourras laisser un avis une fois la coupe honorée.');
      }
      if (stars < 1 || stars > 5) {
        throw new Error('Choisis une note entre 1 et 5.');
      }
      const service = state.services.find((item) => item.id === booking.serviceId);
      state.reviews.push({
        id: crypto.randomUUID(),
        barberId: booking.barberId,
        serviceId: booking.serviceId,
        clientName: user.fullName,
        serviceName: service?.name ?? '',
        stars,
        body: body.trim(),
        status: 'en_attente',
        date: zonedParts(new Date()).isoDate,
      });
      emit();
    },
    async prepareOnlinePayment() {
      await ready;
      return { mode: 'demo', clientSecret: null };
    },
    async validatePromo(input) {
      await ready;
      return admin.quotePromo(input.code, input.date, input.subtotalCents);
    },
    setNotificationOptIn: (enabled) => admin.setNotificationOptIn(enabled),
    notificationOptIn: () => admin.notificationOptIn(),
    listMyNotifications: () => admin.listMyNotifications(),
    async getDashboard(input) {
      await ready;
      return admin.getDashboard(input.anchor, input.period);
    },
    async getDay(date) {
      await ready;
      return admin.getDay(date);
    },
    async getAgenda(input) {
      await ready;
      return admin.getAgenda(input.date, input.barberId ?? null);
    },
    async blockSlot(input) {
      await ready;
      await admin.blockSlot(input);
    },
    async unblockSlot(blockId) {
      await ready;
      await admin.unblockSlot(blockId);
    },
    async moveBooking(input) {
      await ready;
      await admin.moveBooking(input);
    },
    async honorBooking(bookingId) {
      await ready;
      await admin.honorBooking(bookingId);
    },
    async cancelClientBooking(bookingId) {
      await ready;
      await admin.cancelClientBooking(bookingId, async (id) => {
        const booking = state.bookings.find((item) => item.id === id);
        if (!booking) {
          throw new Error('Rendez-vous introuvable.');
        }
        if (!booking.clientId) {
          if (booking.status === 'honore' || booking.status === 'annule' || booking.status === 'annule_tardif') {
            throw new Error('Ce rendez-vous ne peut plus être annulé.');
          }
          if (zonedDateTime(booking.date, booking.startMinute).getTime() <= Date.now()) {
            throw new Error('Ce rendez-vous ne peut plus être annulé.');
          }
          booking.status = 'annule';
          emit();
          return present(state, booking);
        }
        const previous = state.sessionUserId;
        state.sessionUserId = booking.clientId;
        try {
          return await repository.cancelBooking(id);
        } finally {
          state.sessionUserId = previous;
        }
      });
    },
    async listPayments(input) {
      await ready;
      return admin.listPayments(input.from, input.to);
    },
    async refundFee(bookingId) {
      await ready;
      await admin.refundFee(bookingId);
    },
    listClients: async () => {
      await ready;
      return admin.listClients();
    },
    saveClientNote: async (clientId, note) => {
      await ready;
      await admin.saveClientNote(clientId, note);
    },
    listStaffReviews: async () => {
      await ready;
      return admin.listStaffReviews();
    },
    moderateReview: async (reviewId, status) => {
      await ready;
      await admin.moderateReview(reviewId, status);
    },
    listPromos: async () => {
      await ready;
      return admin.listPromos();
    },
    savePromo: async (promo) => {
      await ready;
      await admin.savePromo(promo);
    },
    listTeam: async () => {
      await ready;
      return admin.listTeam();
    },
    setMemberRole: async (userId, role) => {
      await ready;
      await admin.setMemberRole(userId, role);
    },
    setMemberActive: async (userId, active) => {
      await ready;
      await admin.setMemberActive(userId, active);
    },
    inviteMember: async (input) => {
      await ready;
      return admin.inviteMember(input);
    },
    async updateSalonSettings(input) {
      await ready;
      await admin.updateSalonSettings(input);
      return repository.getSalon();
    },
    updateService: async (input) => {
      await ready;
      requireOwner('services');
      const service = state.services.find((item) => item.id === input.serviceId);
      const before = service?.priceCents;
      await admin.updateService(input.serviceId, input.priceCents);
      if (service && before !== undefined && before !== input.priceCents) {
        state.priceHistory.unshift({ id: crypto.randomUUID(), serviceId: service.id, oldCents: before, newCents: input.priceCents, at: clock().toISOString() });
        auditEntry(state, 'prestation_prix', `${service.name} : ${formatCad(before)} → ${formatCad(input.priceCents)}`);
        emit();
      }
    },
    async setSalonHours({ week, force }) {
      await ready;
      requireOwner('barbers');
      const clean = validateSalonWeek(week);
      const now = clock();
      const outside = futureOutsideWeek(
        state.bookings
          .filter((booking) => ACTIVE.has(booking.status) && zonedDateTime(booking.date, booking.startMinute).getTime() > now.getTime())
          .map((booking) => ({ id: booking.id, weekday: weekdayOfIso(booking.date), startMinute: booking.startMinute, durationMinutes: booking.durationMinutes })),
        clean,
      );
      if (outside.length > 0 && !force) {
        throw new Error(hoursConflictMessage(outside));
      }
      state.salonWeek = clean;
      // F-2 : forcé, les rendez-vous hors horaires restent ; le client est avisé et le journal en garde le nombre.
      for (const id of outside) {
        const booking = state.bookings.find((item) => item.id === id);
        if (booking) {
          admin.notifyChange(booking, 'changement', `Le salon a changé ses heures. Ton rendez-vous du ${formatLongDate(booking.date)} à ${formatTime(booking.startMinute)} est maintenu ; on te contactera au besoin.`);
        }
      }
      auditEntry(
        state,
        'salon_horaires',
        clean.map((day) => `${weekdayLong(day.weekday)} ${day.open ? dayHoursLabel(day.openMinute, day.closeMinute) : 'fermé'}`).join(' · ') +
          (outside.length > 0 ? ` · ${outside.length} rendez-vous hors horaires maintenus` : ''),
      );
      emit();
      return repository.getSalon();
    },
    async updateServiceDetails(input) {
      await ready;
      requireOwner('services');
      const service = state.services.find((item) => item.id === input.serviceId);
      if (!service) {
        throw new Error('Prestation introuvable.');
      }
      const clean = validateServiceDetails(
        input,
        state.services.filter((item) => item.active !== false && item.id !== service.id).map((item) => item.name),
      );
      if (clean.name === service.name && clean.description === service.description && clean.durationMinutes === service.durationMinutes) {
        return;
      }
      const changes = [
        clean.name !== service.name ? `nom : ${service.name} → ${clean.name}` : null,
        clean.durationMinutes !== service.durationMinutes ? `durée : ${service.durationMinutes} → ${clean.durationMinutes} min` : null,
        clean.description !== service.description ? 'description' : null,
      ].filter(Boolean);
      service.name = clean.name;
      service.description = clean.description;
      service.durationMinutes = clean.durationMinutes;
      auditEntry(state, 'prestation_modification', `${clean.name} · ${changes.join(', ')}`);
      emit();
    },
    async listPriceHistory(serviceId) {
      await ready;
      requireOwner('services');
      return state.priceHistory
        .filter((entry) => entry.serviceId === serviceId)
        .map(({ id, at, oldCents, newCents }) => ({ id, at, oldCents, newCents }));
    },
    async reassignBarberBookings({ fromBarberId, toBarberId }) {
      await ready;
      requireOwner('barbers');
      const from = state.barbers.find((item) => item.id === fromBarberId);
      if (!from) {
        throw new Error('Coiffeur introuvable.');
      }
      const to = state.barbers.find((item) => item.id === toBarberId);
      if (!to || !to.active || to.id === from.id) {
        throw new Error(REASSIGN_TARGET_MESSAGE);
      }
      releaseExpiredHolds(state);
      const now = clock();
      const days = state.schedules.get(to.id) ?? ALL_WEEKDAYS;
      const offered = offeredBy(to.id);
      const pending = state.bookings
        .filter(
          (booking) =>
            booking.barberId === from.id &&
            isUpcomingBooking({ status: booking.status, endsAt: zonedDateTime(booking.date, booking.startMinute + booking.durationMinutes) }, now),
        )
        .sort((a, b) => a.date.localeCompare(b.date) || a.startMinute - b.startMinute);
      let moved = 0;
      for (const booking of pending) {
        const start = booking.startMinute;
        const end = start + occupancyMinutes(booking.durationMinutes);
        const clash =
          state.bookings.some(
            (other) =>
              other.id !== booking.id &&
              other.barberId === to.id &&
              other.date === booking.date &&
              ACTIVE.has(other.status) &&
              other.startMinute < end &&
              other.startMinute + occupancyMinutes(other.durationMinutes) > start,
          ) ||
          state.blocks.some((block) => block.barberId === to.id && block.date === booking.date && block.startMinute < end && block.endMinute > start);
        // M-2 : le créneau doit aussi tenir dans les heures du salon ce jour-là.
        const hours = salonDayHours(weekdayOfIso(booking.date), state.salonWeek);
        const inHours = hours !== null && start >= hours.openMinute && end <= hours.closeMinute;
        if (!offered.includes(booking.serviceId) || !days.includes(weekdayOfIso(booking.date)) || clash || !inHours) {
          continue;
        }
        booking.barberId = to.id;
        moved += 1;
        admin.notifyChange(
          booking,
          'changement',
          `Ton rendez-vous du ${formatLongDate(booking.date)} à ${formatTime(booking.startMinute)} sera avec ${to.shortName}.`,
        );
      }
      const kept = pending.length - moved;
      auditEntry(state, 'coiffeur_reassignation', `${from.fullName} → ${to.fullName} · ${moved} réassigné(s), ${kept} restant(s)`);
      emit();
      return { moved, kept };
    },
    async resetDemo() {
      await ready;
      // Garde la session d’un compte de démo ; un compte créé pendant la démo disparaît.
      const keep = seed.users.some((user) => user.id === state.sessionUserId) ? state.sessionUserId : null;
      Object.assign(state, cloneSeed(rebase));
      state.sessionUserId = keep;
      placeDemoLateCancel(state, clock());
      emit();
    },
    setBarberWeekday: async (input) => {
      await ready;
      await admin.setBarberWeekday(input.barberId, input.weekday, input.open);
    },
    listAudit: async () => {
      await ready;
      return admin.listAudit();
    },
    getBarberSetup: async () => {
      await ready;
      return admin.barberSetup();
    },
    setBarberService: async (input) => {
      await ready;
      await admin.setBarberService(input.barberId, input.serviceId, input.eligible);
    },
    setPushToken: async (token) => {
      await ready;
      const user = requireUser();
      state.pushTokens.set(user.id, token);
      emit();
    },
    async listManagedBarbers() {
      await ready;
      requireOwner('barbers');
      return [...state.barbers]
        .sort((a, b) => Number(b.active) - Number(a.active) || a.sortOrder - b.sortOrder)
        .map(
          (barber): ManagedBarber => ({
            id: barber.id,
            slug: barber.slug,
            fullName: barber.fullName,
            shortName: barber.shortName,
            specialty: barber.specialty,
            photo: barber.photo,
            sortOrder: barber.sortOrder,
            active: barber.active,
            weekdays: state.schedules.get(barber.id) ?? ALL_WEEKDAYS,
            serviceIds: offeredBy(barber.id),
            upcomingCount: upcomingCount((booking) => booking.barberId === barber.id),
            accountCount: state.users.filter((user) => user.role === 'coiffeur' && user.barberId === barber.id && user.active !== false).length,
          }),
        );
    },
    async createBarber(input) {
      await ready;
      requireOwner('barbers');
      const clean = validateNewBarber(input, activeServiceIds());
      const id = crypto.randomUUID();
      state.barbers.push({
        id,
        slug: uniqueSlug(clean.fullName, state.barbers.map((barber) => barber.slug)),
        fullName: clean.fullName,
        shortName: clean.shortName,
        specialty: clean.specialty,
        bio: `${clean.shortName} fait partie de l’équipe du Nanomètre.`,
        years: 0,
        photo: '',
        rating: 0,
        reviewCount: 0,
        sortOrder: Math.max(0, ...state.barbers.map((barber) => barber.sortOrder)) + 1,
        active: true,
      });
      state.schedules.set(id, clean.weekdays);
      state.eligibility.set(id, clean.serviceIds);
      auditEntry(state, 'coiffeur_ajout', clean.fullName);
      emit();
      return { id };
    },
    async archiveBarber(barberId) {
      await ready;
      requireOwner('barbers');
      const barber = state.barbers.find((item) => item.id === barberId);
      if (!barber) {
        throw new Error('Coiffeur introuvable.');
      }
      if (!barber.active) {
        throw new Error('Ce coiffeur est déjà retiré.');
      }
      if (!state.barbers.some((item) => item.active && item.id !== barberId)) {
        throw new Error('Il doit rester au moins un coiffeur actif.');
      }
      releaseExpiredHolds(state);
      const upcoming = upcomingCount((booking) => booking.barberId === barberId);
      if (upcoming > 0) {
        throw new Error(upcomingBarberMessage(barber.fullName, upcoming));
      }
      barber.active = false;
      let deactivatedAccounts = 0;
      for (const user of state.users) {
        // Un compte propriétaire lié à la chaise reste actif.
        if (user.role === 'coiffeur' && user.barberId === barberId && user.active !== false) {
          user.active = false;
          deactivatedAccounts += 1;
          if (state.sessionUserId === user.id) {
            state.sessionUserId = null;
          }
        }
      }
      auditEntry(state, 'coiffeur_retrait', deactivatedAccounts > 0 ? `${barber.fullName} · compte désactivé` : barber.fullName);
      emit();
      return { deactivatedAccounts };
    },
    async reactivateBarber(barberId) {
      await ready;
      requireOwner('barbers');
      const barber = state.barbers.find((item) => item.id === barberId);
      if (!barber) {
        throw new Error('Coiffeur introuvable.');
      }
      if (barber.active) {
        throw new Error('Ce coiffeur est déjà actif.');
      }
      const active = activeServiceIds();
      if (!offeredBy(barber.id).some((id) => active.has(id))) {
        throw new Error(reactivateWithoutServiceMessage(barber.shortName));
      }
      if (!(state.schedules.get(barber.id) ?? ALL_WEEKDAYS).some((day) => day >= 0 && day <= 6)) {
        throw new Error(reactivateWithoutWeekdayMessage(barber.shortName));
      }
      barber.active = true;
      auditEntry(state, 'coiffeur_reactivation', barber.fullName);
      emit();
    },
    async listManagedServices() {
      await ready;
      requireOwner('services');
      return [...state.services]
        .sort((a, b) => Number(b.active !== false) - Number(a.active !== false) || a.sortOrder - b.sortOrder)
        .map(
          ({ active, ...service }): ManagedService => ({
            ...service,
            active: active !== false,
            barberIds: state.barbers.filter((barber) => offeredBy(barber.id).includes(service.id)).map((barber) => barber.id),
            upcomingCount: upcomingCount((booking) => booking.serviceId === service.id),
          }),
        );
    },
    async createService(input) {
      await ready;
      requireOwner('services');
      const clean = validateNewService(
        input,
        new Set(state.barbers.filter((barber) => barber.active).map((barber) => barber.id)),
        state.services.filter((service) => service.active !== false).map((service) => service.name),
      );
      const before = state.services.map((service) => service.id);
      const id = crypto.randomUUID();
      state.services.push({
        id,
        slug: uniqueSlug(clean.name, state.services.map((service) => service.slug)),
        name: clean.name,
        description: clean.description,
        durationMinutes: clean.durationMinutes,
        priceCents: clean.priceCents,
        photo: '',
        sortOrder: Math.max(0, ...state.services.map((service) => service.sortOrder)) + 1,
        active: true,
      });
      for (const barber of state.barbers) {
        const current = state.eligibility.get(barber.id);
        if (clean.barberIds.includes(barber.id)) {
          if (current && !current.includes(id)) {
            state.eligibility.set(barber.id, [...current, id]);
          }
        } else if (!current) {
          // Absent voulait dire « toutes » : on fige la liste d’avant, sans la nouvelle.
          state.eligibility.set(barber.id, before);
        }
      }
      auditEntry(state, 'prestation_ajout', clean.name);
      emit();
      return { id };
    },
    async archiveService(serviceId) {
      await ready;
      requireOwner('services');
      const service = state.services.find((item) => item.id === serviceId);
      if (!service) {
        throw new Error('Prestation introuvable.');
      }
      if (service.active === false) {
        throw new Error('Cette prestation est déjà retirée.');
      }
      if (!state.services.some((item) => item.active !== false && item.id !== serviceId)) {
        throw new Error('Le catalogue doit garder au moins une prestation.');
      }
      releaseExpiredHolds(state);
      const upcoming = upcomingCount((booking) => booking.serviceId === serviceId);
      if (upcoming > 0) {
        throw new Error(upcomingServiceMessage(service.name, upcoming));
      }
      const active = activeServiceIds();
      const orphans = state.barbers
        .filter((barber) => barber.active)
        .filter((barber) => {
          const offered = offeredBy(barber.id);
          return offered.includes(serviceId) && !offered.some((id) => id !== serviceId && active.has(id));
        })
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((barber) => barber.shortName);
      if (orphans.length > 0) {
        throw new Error(orphanServiceMessage(orphans));
      }
      service.active = false;
      auditEntry(state, 'prestation_retrait', service.name);
      emit();
    },
    async reactivateService(serviceId, barberIds = []) {
      await ready;
      requireOwner('services');
      const service = state.services.find((item) => item.id === serviceId);
      if (!service) {
        throw new Error('Prestation introuvable.');
      }
      if (service.active !== false) {
        throw new Error('Cette prestation est déjà active.');
      }
      const chosen = [...new Set(barberIds)];
      const activeBarbers = new Set(state.barbers.filter((barber) => barber.active).map((barber) => barber.id));
      if (chosen.length > 50 || chosen.some((id) => !activeBarbers.has(id))) {
        throw new Error('Choisis au moins un coiffeur actif pour cette prestation.');
      }
      // N-4 : comme admin_reactivate_service, au moins un coiffeur actif doit la faire.
      const offered = state.barbers.some((barber) => barber.active && (chosen.includes(barber.id) || offeredBy(barber.id).includes(serviceId)));
      if (!offered) {
        throw new Error(reactivateServiceWithoutBarberMessage(service.name));
      }
      for (const id of chosen) {
        const current = state.eligibility.get(id);
        if (current && !current.includes(serviceId)) {
          state.eligibility.set(id, [...current, serviceId]);
        }
      }
      service.active = true;
      auditEntry(state, 'prestation_reactivation', chosen.length > 0 ? `${service.name} · ${chosen.length} coiffeur(s) ajouté(s)` : service.name);
      emit();
    },
  };

  return repository;
}

export function salonFromSeed(): Salon {
  return { ...seed.salon, week: defaultSalonWeek(), onsiteLatePolicy: 'aucun' };
}
