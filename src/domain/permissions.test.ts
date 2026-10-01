import { describe, expect, it } from 'vitest';
import { AccessDeniedError, assertCan, assertLastOwnerSurvives, can, scopeBarber } from './permissions';

describe('matrice des droits', () => {
  it('donne tout au propriétaire et refuse le tableau au coiffeur', () => {
    expect(can('proprietaire', 'dashboard')).toBe(true);
    expect(can('proprietaire', 'refund')).toBe(true);
    expect(can('coiffeur', 'dashboard')).toBe(false);
    expect(can('coiffeur', 'payments')).toBe(false);
    expect(can('coiffeur', 'agenda')).toBe(true);
    expect(can('coiffeur', 'honor')).toBe(true);
    expect(can('client', 'agenda')).toBe(false);
    expect(() => assertCan('coiffeur', 'refund')).toThrow(AccessDeniedError);
    expect(() => assertCan('coiffeur', 'refund')).toThrow('Accès refusé');
  });

  it('enferme le coiffeur sur sa chaise', () => {
    expect(scopeBarber('coiffeur', 'julien', null)).toBe('julien');
    expect(scopeBarber('coiffeur', 'julien', 'julien')).toBe('julien');
    expect(() => scopeBarber('coiffeur', 'julien', 'karim')).toThrow(AccessDeniedError);
    expect(scopeBarber('proprietaire', 'karim', null)).toBeNull();
    expect(scopeBarber('proprietaire', 'karim', 'julien')).toBe('julien');
  });

  it('garde au moins un propriétaire actif', () => {
    const owners = [{ id: 'karim', active: true }];
    expect(() =>
      assertLastOwnerSurvives({ owners, targetId: 'karim', nextActive: false, nextRole: 'proprietaire' }),
    ).toThrow(/propriétaire actif/);
    expect(() =>
      assertLastOwnerSurvives({ owners, targetId: 'karim', nextActive: true, nextRole: 'coiffeur' }),
    ).toThrow(/propriétaire actif/);
    expect(() =>
      assertLastOwnerSurvives({
        owners: [...owners, { id: 'autre', active: true }],
        targetId: 'karim',
        nextActive: false,
        nextRole: 'proprietaire',
      }),
    ).not.toThrow();
  });
});
