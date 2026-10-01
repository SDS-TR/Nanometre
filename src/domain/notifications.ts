export type NotificationKind = 'confirmation' | 'rappel_24h' | 'rappel_2h' | 'annulation' | 'changement';

export type NotificationDraft = {
  bookingId: string;
  recipient: 'client' | 'coiffeur';
  kind: NotificationKind;
  sendAt: Date;
  title: string;
  body: string;
  /** Chemin interne. Le schéma lenanometre:// reprend le même chemin. */
  path: string;
};

const HOUR = 60 * 60 * 1000;

export function appointmentPath(bookingId: string): string {
  return `/rendez-vous?booking=${bookingId}`;
}

export function planBookingNotifications(input: {
  bookingId: string;
  startsAt: Date;
  createdAt: Date;
  summary: string;
  includeBarber?: boolean;
}): NotificationDraft[] {
  const path = appointmentPath(input.bookingId);
  const drafts: NotificationDraft[] = [
    {
      bookingId: input.bookingId,
      recipient: 'client',
      kind: 'confirmation',
      sendAt: input.createdAt,
      title: 'C’est réservé',
      body: input.summary,
      path,
    },
  ];
  if (input.includeBarber !== false) {
    drafts.push({
      bookingId: input.bookingId,
      recipient: 'coiffeur',
      kind: 'confirmation',
      sendAt: input.createdAt,
      title: 'Nouveau rendez-vous',
      body: input.summary,
      path,
    });
  }
  const dayBefore = new Date(input.startsAt.getTime() - 24 * HOUR);
  const twoHours = new Date(input.startsAt.getTime() - 2 * HOUR);
  if (dayBefore.getTime() > input.createdAt.getTime()) {
    drafts.push({
      bookingId: input.bookingId,
      recipient: 'client',
      kind: 'rappel_24h',
      sendAt: dayBefore,
      title: 'Demain au salon',
      body: `Rappel : ${input.summary}`,
      path,
    });
  }
  if (twoHours.getTime() > input.createdAt.getTime()) {
    drafts.push({
      bookingId: input.bookingId,
      recipient: 'client',
      kind: 'rappel_2h',
      sendAt: twoHours,
      title: 'Dans deux heures',
      body: `Ton rendez-vous approche. ${input.summary}`,
      path,
    });
  }
  return drafts;
}

export function planChangeNotification(input: {
  bookingId: string;
  at: Date;
  summary: string;
  kind: 'annulation' | 'changement';
}): NotificationDraft[] {
  const path = appointmentPath(input.bookingId);
  const title = input.kind === 'annulation' ? 'Rendez-vous annulé' : 'Rendez-vous déplacé';
  return (['client', 'coiffeur'] as const).map((recipient) => ({
    bookingId: input.bookingId,
    recipient,
    kind: input.kind,
    sendAt: input.at,
    title,
    body: input.summary,
    path,
  }));
}
