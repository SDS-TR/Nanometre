import { describe, expect, it } from 'vitest';
import { scrubBreadcrumb, scrubEvent, scrubPersonal, scrubUnknown } from './sentryScrub';

describe('filtre Sentry', () => {
  it('retire courriel, téléphone, identifiant, jeton et nom', () => {
    const raw = '11111111-1111-4111-8111-111111111111 karim@lenanometre.ca 418 555-0199 bearer eyJabc.def.ghi';
    const cleaned = scrubPersonal(raw);
    expect(cleaned).not.toMatch(/karim@|418|11111111|eyJabc/);
    expect(cleaned).toContain('[courriel]');
    expect(cleaned).toContain('[id]');
    expect(cleaned).toContain('[jeton]');
    expect(scrubUnknown({ client_name: 'Loïc Bergeron', note: 'secret', ok: true })).toEqual({
      client_name: '[retiré]',
      note: '[retiré]',
      ok: true,
    });
  });

  it('tronque les URL, ignore la console et code un message serveur sans pile', () => {
    expect(
      scrubBreadcrumb({
        category: 'http',
        data: { url: 'https://exemple.supabase.co/rest/v1/profiles?id=eq.11111111-1111-4111-8111-111111111111' },
      })?.data?.url,
    ).toBe('https://exemple.supabase.co/rest/v1/profiles');
    expect(scrubBreadcrumb({ category: 'console', message: 'mot de passe' })).toBeNull();
    const coded = scrubEvent({
      message: 'Ces rendez-vous : Loïc Bergeron',
      request: { url: 'https://exemple.supabase.co/rest/v1/bookings?id=eq.1', headers: { Authorization: 'Bearer secret' } },
      exception: { values: [{ value: 'Loïc Bergeron (2026-10-03)' }] },
      breadcrumbs: [{ category: 'console', message: 'trace' }],
    });
    expect(coded.message).toBe('erreur-serveur');
    expect(coded.exception?.values?.[0].value).toBe('erreur-serveur');
    expect(coded.request?.url).toBe('https://exemple.supabase.co/rest/v1/bookings');
    expect(coded.request?.headers?.Authorization).toBe('[retiré]');
    expect(coded.breadcrumbs).toEqual([]);
  });

  it('garde la pile d’une exception locale', () => {
    const kept = scrubEvent({
      exception: { values: [{ value: 'Tarif invalide pour 11111111-1111-4111-8111-111111111111', stacktrace: { frames: [{ filename: 'app.tsx' }] } }] },
    });
    expect(kept.exception?.values?.[0].stacktrace?.frames).toHaveLength(1);
    expect(kept.exception?.values?.[0].value).toContain('[id]');
    expect(kept.exception?.values?.[0].value).not.toContain('11111111');
  });
});
