import type { LoyaltyState, PaymentMethod, PaymentStatus, BookingLifecycle } from '../domain';

export type Role = 'client' | 'coiffeur' | 'proprietaire';

export type Salon = {
  name: string;
  tagline: string;
  address: string;
  city: string;
  timezone: string;
  openMinute: number;
  closeMinute: number;
  gstNumber: string;
  qstNumber: string;
  phone: string;
  onsiteLatePolicy: 'aucun' | 'a_la_prochaine';
};

export type Barber = {
  id: string;
  slug: string;
  fullName: string;
  shortName: string;
  specialty: string;
  bio: string;
  years: number;
  photo: string;
  rating: number;
  reviewCount: number;
  sortOrder: number;
};

export type Service = {
  id: string;
  slug: string;
  name: string;
  description: string;
  durationMinutes: number;
  priceCents: number;
  photo: string;
  sortOrder: number;
};

export type Review = {
  id: string;
  barberId: string;
  serviceId: string;
  clientName: string;
  serviceName: string;
  stars: number;
  body: string;
  status: 'en_attente' | 'publie' | 'masque';
  date: string;
};

export type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  barberId: string | null;
  phone: string | null;
};

export type Account = SessionUser & { password: string; active?: boolean };

export type BookingRecord = {
  id: string;
  clientId: string | null;
  clientName: string;
  barberId: string;
  serviceId: string;
  date: string;
  startMinute: number;
  durationMinutes: number;
  priceCents: number;
  gstCents: number;
  qstCents: number;
  totalCents: number;
  paymentMethod: PaymentMethod;
  status: BookingLifecycle;
  paymentStatus: PaymentStatus;
  refundedCents: number;
  feeCents: number;
  feeGstCents: number;
  feeQstCents: number;
  feeHtCents: number;
  loyaltyRedeemed: boolean;
  promoCode?: string | null;
  discountCents?: number;
  feeOwingCents?: number;
};

export type BookingView = BookingRecord & {
  barberName: string;
  serviceName: string;
  barberPhoto: string;
  servicePhoto: string;
};

export type SlotView = {
  startMinute: number;
  endMinute: number;
  available: boolean;
  barberId: string | null;
};

export type CreateBookingInput = {
  serviceId: string;
  barberId: string;
  date: string;
  startMinute: number;
  paymentMethod: PaymentMethod;
  redeemReward: boolean;
  promoCode?: string | null;
};

export type LoyaltyView = LoyaltyState & { cutsPerReward: number };

export type PreparedPayment = { mode: 'demo' | 'stripe'; clientSecret: string | null };

export interface Repository {
  mode: 'local' | 'supabase';
  ready: Promise<void>;
  subscribe(listener: () => void): () => void;
  getSession(): SessionUser | null;
  signIn(email: string, password: string): Promise<SessionUser>;
  signUp(input: { fullName: string; email: string; password: string }): Promise<SessionUser>;
  sendMagicLink(email: string): Promise<{ demo: boolean }>;
  completeMagicLink(email: string): Promise<SessionUser>;
  signOut(): Promise<void>;
  updateProfile(input: { fullName: string; phone: string | null }): Promise<SessionUser>;
  getSalon(): Promise<Salon>;
  getBarbers(): Promise<Barber[]>;
  getServices(): Promise<Service[]>;
  getReviews(barberId: string): Promise<Review[]>;
  getSlots(input: { barberId: string | 'any'; serviceId: string; date: string; now?: Date }): Promise<SlotView[]>;
  getMyBookings(): Promise<BookingView[]>;
  getBooking(id: string): Promise<BookingView>;
  createBooking(input: CreateBookingInput): Promise<BookingView>;
  markPaid(bookingId: string): Promise<BookingView>;
  confirmOnSite(bookingId: string): Promise<BookingView>;
  abandonCheckout(bookingId: string): Promise<void>;
  cancelBooking(bookingId: string, now?: Date): Promise<BookingView>;
  getLoyalty(): Promise<LoyaltyView>;
  submitReview(input: { bookingId: string; stars: number; body: string }): Promise<void>;
  prepareOnlinePayment(bookingId: string): Promise<PreparedPayment>;
  validatePromo(input: { code: string; date: string; subtotalCents: number }): Promise<{ code: string; discountCents: number }>;
  setNotificationOptIn(enabled: boolean): Promise<void>;
  notificationOptIn(): Promise<boolean>;
  listMyNotifications(): Promise<NotificationView[]>;
  getDashboard(input: { anchor: string; period: 'jour' | 'semaine' | 'mois' }): Promise<DashboardView>;
  getDay(date: string): Promise<DashboardView>;
  getAgenda(input: { date: string; barberId?: string | null }): Promise<AgendaEntry[]>;
  blockSlot(input: { barberId: string; date: string; startMinute: number; endMinute: number; reason: string }): Promise<void>;
  unblockSlot(blockId: string): Promise<void>;
  moveBooking(input: { bookingId: string; date: string; startMinute: number }): Promise<void>;
  honorBooking(bookingId: string): Promise<void>;
  cancelClientBooking(bookingId: string): Promise<void>;
  listPayments(input: { from: string; to: string }): Promise<PaymentLine[]>;
  refundFee(bookingId: string): Promise<void>;
  listClients(): Promise<ClientFile[]>;
  saveClientNote(clientId: string, note: string): Promise<void>;
  listStaffReviews(): Promise<Review[]>;
  moderateReview(reviewId: string, status: Review['status']): Promise<void>;
  listPromos(): Promise<PromoView[]>;
  savePromo(promo: PromoView): Promise<void>;
  listTeam(): Promise<TeamMember[]>;
  setMemberRole(userId: string, role: Role): Promise<void>;
  setMemberActive(userId: string, active: boolean): Promise<void>;
  inviteMember(input: { fullName: string; email: string; role: Role; barberId: string | null }): Promise<{ invited: true }>;
  updateSalonSettings(input: { openMinute: number; closeMinute: number; onsiteLatePolicy: Salon['onsiteLatePolicy'] }): Promise<Salon>;
  updateService(input: { serviceId: string; priceCents: number }): Promise<void>;
  setBarberWeekday(input: { barberId: string; weekday: number; open: boolean }): Promise<void>;
  listAudit(): Promise<AuditEntry[]>;
  getBarberSetup(): Promise<BarberSetup[]>;
  setBarberService(input: { barberId: string; serviceId: string; eligible: boolean }): Promise<void>;
  setPushToken(token: string): Promise<void>;
}

export type BarberSetup = {
  barberId: string;
  weekdays: number[];
  serviceIds: string[];
};

export type DashboardView = {
  from: string;
  to: string;
  cuts: number;
  booked: number;
  cancelled: number;
  occupancy: number;
  revenueHtCents: number | null;
  revenueTtcCents: number | null;
  perBarber: { name: string; cuts: number; occupancy: number; revenueHtCents: number | null }[];
  topServices: { name: string; count: number; revenueHtCents: number | null }[];
};

export type AgendaEntry = {
  kind: 'booking' | 'block';
  id: string;
  barberId: string;
  barberName: string;
  startMinute: number;
  endMinute: number;
  title: string;
  subtitle: string;
  status?: BookingLifecycle;
  priceLabel: string | null;
  canHonor: boolean;
  canMove: boolean;
  canCancel: boolean;
};

export type PaymentLine = {
  bookingId: string;
  date: string;
  clientName: string;
  label: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amountCents: number;
  feeCents: number;
  refundedCents: number;
  feeRefunded: boolean;
};

export type ClientFile = {
  id: string;
  name: string;
  visits: number;
  note: string;
  points: number | null;
  stamps: number | null;
  spentHtCents: number | null;
  history: { date: string; serviceName: string; barberName: string; priceLabel: string | null; status: string }[];
};

export type PromoView = {
  code: string;
  discountType: 'percent' | 'amount';
  value: number;
  startsOn: string;
  endsOn: string;
  usageLimit: number | null;
  usageCount: number;
  active: boolean;
};

export type TeamMember = {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  barberId: string | null;
  active: boolean;
};

export type AuditEntry = { id: string; action: string; detail: string; at: string };

export type NotificationView = {
  id: string;
  kind: string;
  title: string;
  body: string;
  path: string;
  sendAt: string;
  status: string;
};
