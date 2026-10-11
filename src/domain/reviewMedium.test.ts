import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLocalRepository } from '../data/localRepository';
import { memoryStore } from '../data/storage';
import { chairSpanLabel, mapsSearchUri, openDaysPhrase, payButtonLabel, phoneTelUri, slotLegend } from './format';
import { holdExpired } from './holds';
import { computeDashboard } from './dashboard';

describe('revue moyenne', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('écrit les horaires et la capacité à partir des heures du salon', () => {
    expect(slotLegend(20 * 60)).toContain('20');
    expect(openDaysPhrase([2, 3, 4, 5, 6])).toBe('Du mardi au samedi');
    expect(chairSpanLabel(9 * 60, 20 * 60)).toBe('Sur 11 h par chaise');
    const board = computeDashboard({
      anchor: '2026-10-06',
      period: 'jour',
      bookings: [],
      barbers: [{ fullName: 'Karim' }],
      includeMoney: true,
      openSpanMinutes: 11 * 60,
    });
    expect(board.occupancy).toBe(0);
  });

  it('prépare le téléphone et l’adresse du salon pour un lien', () => {
    expect(phoneTelUri('418 555-0199')).toBe('tel:4185550199');
    expect(mapsSearchUri('425, rue Saint-Vallier Ouest', 'Québec (Québec) G1K 1K8')).toBe(
      'https://www.google.com/maps/search/?api=1&query=425%2C%20rue%20Saint-Vallier%20Ouest%2C%20Qu%C3%A9bec%20(Qu%C3%A9bec)%20G1K%201K8',
    );
    expect(() => phoneTelUri('sans numéro')).toThrow('Téléphone invalide');
    expect(() => mapsSearchUri('  ', ' ')).toThrow('Adresse invalide');
  });

  it('nomme le paiement sur place sans parler d’un prélèvement', () => {
    expect(payButtonLabel('sur_place', 4024)).toBe('Confirmer la réservation');
    expect(payButtonLabel('en_ligne', 4024)).toContain('Payer');
  });

  it('libère un paiement abandonné après 15 minutes', () => {
    const start = new Date('2026-10-06T15:00:00Z');
    expect(holdExpired(new Date(start.getTime() - 14 * 60 * 1000).toISOString(), start)).toBe(false);
    expect(holdExpired(new Date(start.getTime() - 15 * 60 * 1000).toISOString(), start)).toBe(true);
    expect(holdExpired(undefined, start)).toBe(false);
  });

  it('calcule la note sur les avis publiés seulement', async () => {
    const data = createLocalRepository(memoryStore());
    await data.ready;
    const marco = (await data.getBarbers()).find((barber) => barber.fullName.includes('Marco'));
    expect(marco).toBeTruthy();
    const reviews = await data.getReviews(marco!.id);
    const average = reviews.reduce((sum, review) => sum + review.stars, 0) / reviews.length;
    expect(marco!.reviewCount).toBe(reviews.length);
    expect(marco!.rating).toBe(Math.round(average * 10) / 10);
    expect(reviews.every((review) => review.stars === 5)).toBe(true);
  });

  it('refuse un courriel illisible et garde une suppression de compte', async () => {
    const store = memoryStore();
    const data = createLocalRepository(store);
    await data.ready;
    await expect(data.signUp({ fullName: 'Sam', email: 'pas-un-courriel', password: 'motdepasse' })).rejects.toThrow('Courriel invalide.');
    await data.signIn('alex.gagnon@exemple.ca', 'nanometre');
    await data.deleteAccount('SUPPRIMER');
    await new Promise((resolve) => setTimeout(resolve, 30));
    const next = createLocalRepository(store);
    await next.ready;
    await expect(next.signIn('alex.gagnon@exemple.ca', 'nanometre')).rejects.toThrow();
  });

  it('avertit avant de fermer le salon sur un rendez-vous existant', async () => {
    // Les rendez-vous de démo sont datés début octobre 2026 : on fige l’horloge avant eux.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-01T15:00:00Z'));
    const data = createLocalRepository(memoryStore());
    await data.ready;
    await data.signIn('karim@lenanometre.ca', 'nanometre');
    await expect(data.updateSalonSettings({ openMinute: 12 * 60, closeMinute: 13 * 60, onsiteLatePolicy: 'aucun' })).rejects.toThrow(/sortent/);
    const salon = await data.getSalon();
    expect(salon.openMinute).toBe(9 * 60);
  });
});
