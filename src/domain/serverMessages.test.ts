import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  friendlyError,
  INVITE_LIMIT_MESSAGE,
  INVITE_UNAVAILABLE_MESSAGE,
  isKnownServerMessage,
  KNOWN_MESSAGES,
  KNOWN_TEMPLATES,
  lastWeekdayMessage,
  orphanServiceMessage,
  reactivateServiceWithoutBarberMessage,
  reactivateWithoutServiceMessage,
  reactivateWithoutWeekdayMessage,
  upcomingBarberMessage,
  upcomingBarberServiceMessage,
  upcomingServiceMessage,
  upcomingWeekdayMessage,
} from '.';

const root = path.resolve(import.meta.dirname, '../..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

function sqlMessages(): string[] {
  const found = new Set<string>();
  for (const name of readdirSync(path.join(root, 'supabase/migrations')).filter((file) => file.endsWith('.sql'))) {
    const sql = read(`supabase/migrations/${name}`);
    for (const match of sql.matchAll(/raise exception '((?:[^']|'')*)'/gi)) {
      found.add(match[1].replace(/''/g, "'"));
    }
    for (const match of sql.matchAll(/'error',\s*'((?:[^']|'')*)'/g)) {
      found.add(match[1].replace(/''/g, "'"));
    }
  }
  // « % » seul relaie un texte déjà listé (réponse `error` de quote_promo).
  found.delete('%');
  return [...found].sort();
}

function thrownMessages(file: string): string[] {
  return [...read(file).matchAll(/new Error\('([^']*)'\)/g)].map((match) => match[1]);
}

const RAW = [
  'deadlock detected',
  'could not serialize access due to concurrent update',
  'canceling statement due to statement timeout',
  'canceling statement due to lock timeout',
  'value too long for type character varying(80)',
  'integer out of range',
  'numeric field overflow',
  'duplicate key value violates unique constraint "barber_services_pkey"',
  'new row for relation "schedules" violates check constraint "schedules_weekday_check"',
  'permission denied for function admin_set_service',
  'Could not find the function public.admin_reactivate_service(p_barbers, p_service) in the schema cache',
  'JWT expired',
  'Network request failed',
  'TypeError: Network request failed',
  'Failed to fetch',
  'fetch failed',
  'Failed to send a request to the Edge Function',
  'Edge Function returned a non-2xx status code',
  'The operation was aborted.',
  'Invalid login credentials',
  'ERROR: Accès refusé',
  'Accès refusé; drop table bookings',
  'deadlock detected doit garder au moins un jour de travail.\nDETAIL: Process 12 waits for ShareLock',
  'n’importe quoi',
];

describe('N-3 : liste blanche des messages serveur', () => {
  it('connaît chaque message en français des migrations, mot pour mot', () => {
    const known = new Set([...KNOWN_MESSAGES, ...KNOWN_TEMPLATES]);
    expect(sqlMessages().length).toBeGreaterThan(80);
    expect(sqlMessages()).toContain('% a encore % rendez-vous à venir pour « % ». Déplace-les ou annule-les dans l’agenda, puis réessaie.');
    expect(sqlMessages()).toContain('« % » n’est faite par aucun coiffeur actif. Choisis au moins un coiffeur, puis réactive-la.');
    const missing = sqlMessages().filter((message) => !known.has(message));
    expect(missing).toEqual([]);
  });

  it('laisse passer ces messages, avec leurs valeurs', () => {
    for (const message of sqlMessages()) {
      const filled = message.replace(/%/g, '2');
      expect(friendlyError(new Error(filled), 'Repli.'), message).toBe(filled);
    }
  });

  it('connaît les messages de l’Edge Function d’invitation', () => {
    const handler = read('supabase/functions/invite-team-member/handler.ts');
    const logic = read('supabase/functions/invite-team-member/logic.ts');
    const messages = [
      ...[...handler.matchAll(/error: '([^']*)'/g)].map((match) => match[1]),
      ...thrownMessages('supabase/functions/invite-team-member/logic.ts'),
      ...[...handler.matchAll(/_MESSAGE = '([^']*)'/g)].map((match) => match[1]),
    ];
    expect(messages.length).toBeGreaterThan(8);
    expect(logic).toContain('Choisis la chaise de ce coiffeur.');
    for (const message of messages) {
      expect(isKnownServerMessage(message), message).toBe(true);
    }
    expect(handler).toContain(INVITE_UNAVAILABLE_MESSAGE);
    expect(handler).toContain(INVITE_LIMIT_MESSAGE);
  });

  it('connaît les messages du mode démo et des règles partagées', () => {
    const files = [
      'src/data/localAdmin.ts',
      'src/data/localRepository.ts',
      'src/domain/catalogue.ts',
      'src/domain/promo.ts',
      'src/domain/salonHours.ts',
      'src/domain/moveSlot.ts',
      'src/domain/adminForms.ts',
    ];
    const messages = files.flatMap(thrownMessages);
    expect(messages.length).toBeGreaterThan(30);
    for (const message of messages) {
      expect(isKnownServerMessage(message), message).toBe(true);
    }
    const generated = [
      upcomingBarberMessage('Marco Rossi', 2),
      upcomingServiceMessage('Coupe classique', 1),
      upcomingWeekdayMessage('Marco', 3, 4),
      upcomingBarberServiceMessage('Marco', 1, 'Coupe classique'),
      orphanServiceMessage(['Marco', 'Noah']),
      lastWeekdayMessage('Marco'),
      reactivateWithoutServiceMessage('Marco'),
      reactivateWithoutWeekdayMessage('Marco'),
      reactivateServiceWithoutBarberMessage('Rasage'),
    ];
    for (const message of generated) {
      expect(friendlyError(new Error(message), 'Repli.')).toBe(message);
    }
  });

  it('remplace tout le reste par le texte de repli', () => {
    for (const raw of RAW) {
      expect(friendlyError(new Error(raw), 'Action impossible.'), raw).toBe('Action impossible.');
      expect(friendlyError(raw, 'Action impossible.'), raw).toBe('Action impossible.');
      expect(friendlyError({ message: raw, code: '40P01' }, 'Action impossible.'), raw).toBe('Action impossible.');
    }
    for (const value of [null, undefined, 42, {}, { message: 42 }, new Error(''), '   ']) {
      expect(friendlyError(value, 'Action impossible.')).toBe('Action impossible.');
    }
    expect(friendlyError(new Error(`${'Marco '.repeat(80)}doit garder au moins un jour de travail.`), 'Repli.')).toBe('Repli.');
  });

  it('accepte une erreur PostgREST ou un texte, et retire les espaces autour', () => {
    expect(friendlyError({ message: 'Ce créneau n’est plus libre.', code: 'P0001' }, 'Repli.')).toBe('Ce créneau n’est plus libre.');
    expect(friendlyError('  Tarif invalide. ', 'Repli.')).toBe('Tarif invalide.');
  });

  it('est utilisée par chaque écran de gestion qui affiche une erreur', () => {
    const screens = [
      'app/(admin)/admin/gestion/prestations.tsx',
      'app/(admin)/admin/gestion/nouveau-coiffeur.tsx',
      'app/(admin)/admin/gestion/nouvelle-prestation.tsx',
      'app/(admin)/admin/gestion/coiffeurs.tsx',
      'app/(admin)/admin/gestion/equipe.tsx',
      'app/(admin)/admin/gestion/salon.tsx',
      'app/(admin)/admin/gestion/promos.tsx',
      'app/(admin)/admin/agenda.tsx',
      'app/(admin)/admin/paiements.tsx',
      'src/components/PanneauClients.tsx',
      'src/components/PanneauAvis.tsx',
      'src/hooks/useAsync.ts',
    ];
    for (const screen of screens) {
      const source = read(screen);
      expect(source, screen).toContain('friendlyError');
      expect(source, screen).not.toMatch(/reason\.message/);
    }
    const gestion = readdirSync(path.join(root, 'app/(admin)/admin/gestion')).filter((file) => file.endsWith('.tsx'));
    for (const file of gestion) {
      expect(read(`app/(admin)/admin/gestion/${file}`), file).not.toMatch(/reason\.message/);
    }
  });
});
