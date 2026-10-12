import { zonedDateTime } from './zonedTime';

const OPEN_STATUSES = new Set(['confirme', 'en_attente_paiement', 'honore']);

/** Heures du salon : 0 à 24 h, pas de 15 minutes, fermeture après l’ouverture. */
export function assertSalonHourBounds(openMinute: number, closeMinute: number): void {
  const aligned =
    Number.isInteger(openMinute) &&
    Number.isInteger(closeMinute) &&
    openMinute >= 0 &&
    closeMinute <= 24 * 60 &&
    openMinute % 15 === 0 &&
    closeMinute % 15 === 0 &&
    closeMinute > openMinute;
  if (!aligned) {
    throw new Error('Réglage invalide.');
  }
}

/** Rendez-vous à venir dont l’occupation sort de la plage. Les visites passées ne comptent pas. */
export function futureOutsideHours(
  bookings: { id: string; date: string; startMinute: number; durationMinutes: number; status: string }[],
  openMinute: number,
  closeMinute: number,
  now: Date,
): string[] {
  return bookings
    .filter((booking) => {
      if (!OPEN_STATUSES.has(booking.status)) {
        return false;
      }
      if (zonedDateTime(booking.date, booking.startMinute).getTime() <= now.getTime()) {
        return false;
      }
      return booking.startMinute < openMinute || booking.startMinute + booking.durationMinutes > closeMinute;
    })
    .map((booking) => booking.id);
}

/** Identifiants seulement : le message SQL et les journaux ne portent pas de nom. */
/** F-1 : le total est réel ; seuls les 8 premiers identifiants sont listés. */
export function hoursConflictMessage(ids: string[]): string {
  return `Ces rendez-vous à venir sortent des nouvelles heures (${ids.length}). Identifiants : ${ids.slice(0, 8).join(', ')}.`;
}
