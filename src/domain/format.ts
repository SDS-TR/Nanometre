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

const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** « 418 555-0199 » → « tel:4185550199 ». */
export function phoneTelUri(phone: string): string {
  const compact = phone.replace(/[^\d+]/g, '');
  if (!/^\+?\d{10,15}$/.test(compact)) {
    throw new Error('Téléphone invalide');
  }
  return `tel:${compact}`;
}

/** Adresse et ville → recherche Google Maps. */
export function mapsSearchUri(address: string, city: string): string {
  const query = [address, city]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(', ');
  if (!query) {
    throw new Error('Adresse invalide');
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** « Du mardi au samedi » quand les jours se suivent. */
export function openDaysPhrase(weekdays: number[]): string {
  const days = [...new Set(weekdays)].filter((day) => day >= 0 && day <= 6).sort((a, b) => a - b);
  if (days.length === 0) {
    return 'Fermé';
  }
  const contiguous = days.every((day, index) => index === 0 || day === days[index - 1] + 1);
  if (contiguous && days.length > 1) {
    return `Du ${WEEKDAYS[days[0]]} au ${WEEKDAYS[days[days.length - 1]]}`;
  }
  return days.map((day) => WEEKDAYS[day]).join(', ');
}

export function slotLegend(closeMinute: number): string {
  return `Créneaux libres uniquement · pas de 15 min · fin au plus tard à ${formatTime(closeMinute)}`;
}

export function shiftMonth(isoDate: string, delta: number): string {
  const [year, month] = isoDate.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

export function monthTitle(isoDate: string): string {
  const [year, month] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('fr-CA', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1, 12)));
}

const AUDIT_LABELS: Record<string, string> = {
  invitation: 'Invitation',
  role: 'Rôle',
  desactivation: 'Désactivation',
  reactivation: 'Réactivation',
  deplacement: 'Déplacement',
  annulation: 'Annulation',
  remboursement_frais: 'Remboursement de frais',
  coiffeur_ajout: 'Coiffeur ajouté',
  coiffeur_retrait: 'Coiffeur retiré',
  coiffeur_reactivation: 'Coiffeur réactivé',
  prestation_ajout: 'Prestation ajoutée',
  prestation_retrait: 'Prestation retirée',
  prestation_reactivation: 'Prestation réactivée',
  coiffeur_jour: 'Jours de travail',
  coiffeur_prestation: 'Prestations du coiffeur',
};

export function readableAudit(action: string, detail: string): string {
  const label = AUDIT_LABELS[action] ?? action;
  const cleaned = detail.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '').replace(/\s·\s·/g, ' · ').trim();
  return cleaned ? `${label} · ${cleaned}` : label;
}

export function payButtonLabel(method: 'en_ligne' | 'sur_place', totalCents: number | null): string {
  if (totalCents == null) {
    return 'Payer';
  }
  if (totalCents === 0) {
    return 'Confirmer · coupe offerte';
  }
  if (method === 'sur_place') {
    return 'Confirmer la réservation';
  }
  return `Payer ${formatCad(totalCents)}`;
}

export function chairSpanLabel(openMinute: number, closeMinute: number): string {
  const hours = Math.round(((closeMinute - openMinute) / 60) * 10) / 10;
  const label = String(hours).replace('.', ',');
  return `Sur ${label} h par chaise`;
}
