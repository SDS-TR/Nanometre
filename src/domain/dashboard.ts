import { isOpenWeekday } from './slots';
import { addDaysIso, weekdayOfIso } from './zonedTime';

export type DashboardPeriod = 'jour' | 'semaine' | 'mois';

export type DashboardBooking = {
  date: string;
  barberName: string;
  serviceName: string;
  durationMinutes: number;
  priceCents: number;
  discountCents: number;
  totalCents: number;
  feeCents: number;
  feeHtCents: number;
  status: 'en_attente_paiement' | 'confirme' | 'honore' | 'annule' | 'annule_tardif';
};

export type DashboardBarber = { fullName: string };

const OPEN_SPAN = 10 * 60;

export function periodBounds(anchor: string, period: DashboardPeriod): { from: string; to: string } {
  if (period === 'jour') {
    return { from: anchor, to: anchor };
  }
  if (period === 'mois') {
    const [year, month] = anchor.split('-').map(Number);
    const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const pad = (value: number) => String(value).padStart(2, '0');
    return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(last)}` };
  }
  const sinceTuesday = (weekdayOfIso(anchor) + 5) % 7;
  const from = addDaysIso(anchor, -sinceTuesday);
  return { from, to: addDaysIso(from, 4) };
}

function inRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

function countsAsCut(status: DashboardBooking['status']): boolean {
  return status === 'honore' || status === 'confirme';
}

export function computeDashboard(input: {
  anchor: string;
  period: DashboardPeriod;
  bookings: DashboardBooking[];
  barbers: DashboardBarber[];
  includeMoney: boolean;
}) {
  const { from, to } = periodBounds(input.anchor, input.period);
  const rows = input.bookings.filter((booking) => inRange(booking.date, from, to));
  const cuts = rows.filter((booking) => countsAsCut(booking.status));
  const cancelled = rows.filter((booking) => booking.status === 'annule' || booking.status === 'annule_tardif');
  const openDays = eachDate(from, to).filter((date) => isOpenWeekday(weekdayOfIso(date)));
  const capacity = Math.max(1, input.barbers.length) * OPEN_SPAN * Math.max(1, openDays.length);
  const busy = cuts.reduce((sum, booking) => sum + booking.durationMinutes, 0);
  // priceCents est déjà le hors taxes après promo. Les frais tardifs ajoutent leur part HT.
  const revenueHt = cuts.reduce((sum, booking) => sum + booking.priceCents, 0) +
    rows.filter((booking) => booking.status === 'annule_tardif').reduce((sum, booking) => sum + booking.feeHtCents, 0);
  const revenueTtc = cuts.reduce((sum, booking) => sum + booking.totalCents, 0) +
    rows.filter((booking) => booking.status === 'annule_tardif').reduce((sum, booking) => sum + booking.feeCents, 0);

  const perBarber = input.barbers.map((barber) => {
    const own = cuts.filter((booking) => booking.barberName === barber.fullName);
    const ownBusy = own.reduce((sum, booking) => sum + booking.durationMinutes, 0);
    const barberCapacity = OPEN_SPAN * Math.max(1, openDays.length);
    return {
      name: barber.fullName,
      cuts: own.length,
      occupancy: ownBusy / barberCapacity,
      revenueHtCents: input.includeMoney ? own.reduce((sum, booking) => sum + booking.priceCents, 0) : null,
    };
  });

  const byService = new Map<string, { count: number; revenueHtCents: number }>();
  for (const booking of cuts) {
    const current = byService.get(booking.serviceName) ?? { count: 0, revenueHtCents: 0 };
    current.count += 1;
    current.revenueHtCents += booking.priceCents;
    byService.set(booking.serviceName, current);
  }

  return {
    from,
    to,
    cuts: cuts.length,
    booked: rows.length,
    cancelled: cancelled.length,
    occupancy: busy / capacity,
    revenueHtCents: input.includeMoney ? revenueHt : null,
    revenueTtcCents: input.includeMoney ? revenueTtc : null,
    perBarber,
    topServices: [...byService.entries()]
      .map(([name, value]) => ({
        name,
        count: value.count,
        revenueHtCents: input.includeMoney ? value.revenueHtCents : null,
      }))
      .sort((a, b) => b.count - a.count),
  };
}

function eachDate(from: string, to: string): string[] {
  const dates: string[] = [];
  let cursor = from;
  while (cursor <= to && dates.length < 40) {
    dates.push(cursor);
    cursor = addDaysIso(cursor, 1);
  }
  return dates;
}
