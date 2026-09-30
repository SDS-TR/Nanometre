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

export type Account = SessionUser & { password: string };

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
}
