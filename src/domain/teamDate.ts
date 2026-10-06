import { zonedParts } from './zonedTime';

/** Journée chargée dans les captures de démo. Jamais en production. */
export const DEMO_TEAM_DATE = '2026-10-03';

export function demoTeamDateEnabled(dev = typeof __DEV__ !== 'undefined' && __DEV__): boolean {
  return dev && process.env.EXPO_PUBLIC_DEMO_DATE === '1';
}

/** L’espace équipe s’ouvre sur aujourd’hui, à Québec. */
export function teamDate(now: Date, demo = demoTeamDateEnabled()): string {
  return demo ? DEMO_TEAM_DATE : zonedParts(now).isoDate;
}
