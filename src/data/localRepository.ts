import {
  computeLineTaxes,
  CUTS_PER_REWARD,
  emptyLoyalty,
  generateSlots,
  isOpenWeekday,
  assertLastOwnerSurvives,
  quoteCancellation,
  restoreReward,
  type PromoCode,
  weekdayOfIso,
  zonedDateTime,
  zonedParts,
  type BookingLifecycle,
  type LoyaltyState,
  type PaymentMethod,
  type PaymentStatus,
} from '../domain';
import { maskClientName } from '../lib/privacy';
import { createAdmin, defaultPromos, type BlockSlot, type StoredNotification } from './localAdmin';
import seed from './seed.normalized.json';
import type { KeyValueStore } from './storage';
import type {
  Account,
  Barber,
  BookingRecord,
  BookingView,
  LoyaltyView,
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
  services: Service[];
  eligibility: Map<string, string[]>;
  pushTokens: Map<string, string>;
};

function cloneSeed(): State {
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
        paymentMethod: booking.paymentMethod as PaymentMethod,
        status: booking.status as BookingLifecycle,
        paymentStatus: booking.paymentStatus as PaymentStatus,
      }),
    ),
    loyalty,
    reviews: seed.reviews.map(
      (review): Review => ({
        ...review,
        status: review.status as Review['status'],
      }),
    ),
    pendingMagicEmail: null,
    blocks: [],
    notes: new Map(),
    promos: defaultPromos(),
    openMinute: seed.salon.openMinute,
    closeMinute: seed.salon.closeMinute,
    onsiteLatePolicy: 'aucun',
    schedules: new Map(seed.barbers.map((barber) => [barber.id, [2, 3, 4, 5, 6]])),
    notifications: [],
    optIn: new Set(),
    audit: [],
    services: seed.services.map((service) => ({ ...service })) as Service[],
    eligibility: new Map(),
    pushTokens: new Map(),
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
  const barber = seed.barbers.find((item) => item.id === booking.barberId);
  const service = seed.services.find((item) => item.id === booking.serviceId);
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
  const service = seed.services.find((item) => item.slug === 'coupe-classique');
  const barber = seed.barbers.find((item) => item.slug === 'karim-b');
  if (!service || !barber) {
    return;
  }
  const today = zonedParts(now).isoDate;
  for (let offset = 0; offset < 4; offset += 1) {
    const date = shift(today, offset);
    if (!isOpenWeekday(weekdayOfIso(date))) {
      continue;
    }
    const slots = generateSlots({
      weekday: weekdayOfIso(date),
      durationMinutes: service.durationMinutes,
      busy: busyFor(state, barber.id, date),
      earliestStartMinute: date === today ? zonedParts(now).minuteOfDay + 15 : undefined,
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

export function createLocalRepository(storage: KeyValueStore): Repository {
  let state = cloneSeed();
  const listeners = new Set<() => void>();

  const ready = (async () => {
    const raw = await storage.getItem(STORAGE_KEY);
    if (raw) {
      applyDelta(state, JSON.parse(raw) as Delta);
    }
    placeDemoLateCancel(state, new Date());
    await persist();
  })();

  async function persist() {
    const seedIds = new Set(seed.bookings.map((booking) => booking.id));
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
      bookingPatches: state.bookings.filter((booking) => {
        if (!seedIds.has(booking.id)) {
          return true;
        }
        const original = seed.bookings.find((item) => item.id === booking.id);
        return JSON.stringify(original) !== JSON.stringify(booking);
      }),
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

  const admin = createAdmin({
    state,
    barbers: seed.barbers.map((barber) => ({ id: barber.id, fullName: barber.fullName, shortName: barber.shortName })),
    emit,
  });

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
      return { ...seed.salon, openMinute: state.openMinute, closeMinute: state.closeMinute, onsiteLatePolicy: state.onsiteLatePolicy };
    },
    async getBarbers() {
      await ready;
      return [...seed.barbers].sort((a, b) => a.sortOrder - b.sortOrder) as Barber[];
    },
    async getServices() {
      await ready;
      return [...state.services].sort((a, b) => a.sortOrder - b.sortOrder);
    },
    async getReviews(barberId) {
      await ready;
      return state.reviews
        .filter((review) => review.barberId === barberId && review.status === 'publie')
        .map((review) => ({ ...review, clientName: maskClientName(review.clientName) }));
    },
    async getSlots({ barberId, serviceId, date, now = new Date() }) {
      await ready;
      const service = state.services.find((item) => item.id === serviceId);
      if (!service) {
        throw new Error('Prestation introuvable.');
      }
      const weekday = weekdayOfIso(date);
      const today = zonedParts(now);
      const earliest = date === today.isoDate ? today.minuteOfDay + 1 : undefined;
      const offers = (id: string) => {
        const allowed = state.eligibility.get(id);
        return !allowed || allowed.includes(serviceId);
      };
      const candidates =
        barberId === 'any'
          ? [...seed.barbers]
              .filter((barber) => offers(barber.id) && (state.schedules.get(barber.id) ?? []).includes(weekday))
              .sort((a, b) => busyFor(state, a.id, date).length - busyFor(state, b.id, date).length)
          : seed.barbers.filter((item) => item.id === barberId && offers(item.id) && (state.schedules.get(item.id) ?? []).includes(weekday));
      const grid = generateSlots({
        weekday,
        durationMinutes: service.durationMinutes,
        earliestStartMinute: earliest,
        openMinute: state.openMinute,
        closeMinute: state.closeMinute,
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
      const barber = seed.barbers.find((item) => item.id === input.barberId);
      if (!service || !barber) {
        throw new Error('Choix incomplet.');
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
        status: input.paymentMethod === 'en_ligne' ? 'en_attente_paiement' : 'confirme',
        paymentStatus: input.paymentMethod === 'en_ligne' ? 'en_attente' : 'a_encaisser',
        refundedCents: 0,
        feeCents: 0,
        feeGstCents: 0,
        feeQstCents: 0,
        feeHtCents: 0,
        loyaltyRedeemed: input.redeemReward,
        promoCode,
        discountCents,
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
      const service = seed.services.find((item) => item.id === booking.serviceId);
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
        if (!booking?.clientId) {
          throw new Error('Ce rendez-vous n’a pas de compte client.');
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
      await admin.updateService(input.serviceId, input.priceCents);
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
  };

  return repository;
}

export function salonFromSeed(): Salon {
  return { ...seed.salon, onsiteLatePolicy: 'aucun' };
}
