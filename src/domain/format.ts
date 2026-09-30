const NBSP = '\u00a0';

/** 6324 → « 63,24 $ » (espace insécable avant le symbole). */
export function formatCad(cents: number): string {
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const dollars = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, '0');
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
  return `${negative ? '-' : ''}${grouped},${fraction}${NBSP}$`;
}

/** 870 → « 14 h 30 ». */
export function formatTime(minuteOfDay: number): string {
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  return `${hour}${NBSP}h${NBSP}${String(minute).padStart(2, '0')}`;
}

export function formatTimeRange(startMinute: number, endMinute: number): string {
  return `${formatTime(startMinute)} → ${formatTime(endMinute)}`;
}

/** 4.89 → « 4,9 ». */
export function formatRating(value: number): string {
  return value.toFixed(1).replace('.', ',');
}

export function formatLongDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-CA', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

export function formatChipDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-CA', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })
    .format(new Date(Date.UTC(year, month - 1, day, 12)))
    .replace(/\./g, '');
}

export function formatDuration(minutes: number): string {
  return `${minutes}${NBSP}min`;
}
