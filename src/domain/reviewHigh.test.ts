import { describe, expect, it } from 'vitest';
import { createLocalRepository } from '../data/localRepository';
import { memoryStore } from '../data/storage';
import { mergePromo, parsePriceCents, priceDropNeedsConfirm } from './adminForms';
import { barbersForService } from './eligibility';
import { teamDate, DEMO_TEAM_DATE } from './teamDate';
import { scrubPersonal } from '../lib/sentryScrub';

describe('revue élevée', () => {
  it('ouvre l’équipe sur aujourd’hui, et la date de démo seulement si on le demande', () => {
    const now = new Date('2026-10-06T16:00:00Z');
    expect(teamDate(now, false)).toBe('2026-10-06');
    expect(teamDate(now, true)).toBe(DEMO_TEAM_DATE);
  });

  it('refuse un prix vide, nul ou illisible, et confirme une baisse de plus de la moitié', () => {
    expect(parsePriceCents('55,00')).toBe(5500);
    expect(() => parsePriceCents('')).toThrow('Tarif invalide.');
    expect(() => parsePriceCents('abc')).toThrow('Tarif invalide.');
    expect(() => parsePriceCents('0')).toThrow('Tarif invalide.');
    expect(priceDropNeedsConfirm(5500, 2000)).toBe(true);
    expect(priceDropNeedsConfirm(5500, 4000)).toBe(false);
  });

  it('refuse 150 % et ne remet pas à zéro un code déjà utilisé', async () => {
    expect(() =>
      mergePromo(undefined, {
        code: 'ETE20',
        discountType: 'percent',
        value: 150,
        startsOn: '2026-10-01',
        endsOn: '2026-12-31',
        usageLimit: null,
        usageCount: 0,
        active: true,
      }),
    ).toThrow(/100/);
    const kept = mergePromo(
      {
        code: 'ETE20',
        discountType: 'percent',
        value: 20,
        startsOn: '2026-07-01',
        endsOn: '2026-08-31',
        usageLimit: 30,
        usageCount: 30,
        active: true,
      },
      {
        code: 'ETE20',
        discountType: 'percent',
        value: 10,
        startsOn: '2026-10-01',
        endsOn: '2026-12-31',
        usageLimit: 40,
        usageCount: 0,
        active: false,
      },
    );
    expect(kept.usageCount).toBe(30);
    expect(kept.value).toBe(10);
    expect(kept.active).toBe(false);

    const data = createLocalRepository(memoryStore());
    await data.ready;
    await data.signIn('karim@lenanometre.ca', 'nanometre');
    await expect(data.updateService({ serviceId: (await data.getServices())[0].id, priceCents: 0 })).rejects.toThrow('Tarif invalide.');
    const before = (await data.listPromos()).find((promo) => promo.code === 'ETE20');
    expect(before?.usageCount).toBe(30);
    await data.savePromo({ ...before!, value: 15, usageCount: 0, endsOn: '2026-12-31' });
    const after = (await data.listPromos()).find((promo) => promo.code === 'ETE20');
    expect(after?.usageCount).toBe(30);
    expect(after?.value).toBe(15);
  });

  it('retire un coiffeur qui ne fait pas la prestation', async () => {
    // Seed non décalé : les rendez-vous de Marco du 6 octobre sont passés.
    const data = createLocalRepository(memoryStore(), { now: () => new Date('2026-10-06T12:00:00Z') });
    await data.ready;
    await data.signIn('karim@lenanometre.ca', 'nanometre');
    const services = await data.getServices();
    const enfant = services.find((service) => /enfant/i.test(service.name));
    expect(enfant).toBeTruthy();
    const marco = (await data.getBarbers()).find((barber) => /marco/i.test(barber.fullName));
    expect(marco).toBeTruthy();
    expect(barbersForService(await data.getBarbers(), enfant!.id).some((barber) => barber.id === marco!.id)).toBe(true);
    await data.setBarberService({ barberId: marco!.id, serviceId: enfant!.id, eligible: false });
    const offered = barbersForService(await data.getBarbers(), enfant!.id);
    expect(offered.some((barber) => barber.id === marco!.id)).toBe(false);
  });

  it('retire le courriel et le téléphone avant un envoi', () => {
    expect(scrubPersonal('Écrire à karim@lenanometre.ca ou au 418 555-0199.')).toBe('Écrire à [courriel] ou au [téléphone].');
  });
});
