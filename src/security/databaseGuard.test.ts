import { describe, expect, it } from 'vitest';
import { assertDisposableDatabase, resolveTestDatabase } from './databaseGuard';

describe('garde de la base de test', () => {
  it('accepte le loopback et refuse un hôte distant avant toute connexion', () => {
    expect(() => assertDisposableDatabase('postgres://postgres:postgres@127.0.0.1:5432/nanometre', false)).not.toThrow();
    expect(() => assertDisposableDatabase('postgres://postgres:postgres@localhost:5432/nanometre', false)).not.toThrow();
    expect(() => assertDisposableDatabase('postgres://postgres:postgres@[::1]:5432/nanometre', false)).not.toThrow();
    expect(() => assertDisposableDatabase('postgres://postgres:secret@db.exemple.ca:5432/nanometre', false)).toThrow(/Refus de réinitialiser db\.exemple\.ca/);
    expect(() => assertDisposableDatabase('postgres://postgres:secret@db.exemple.ca:5432/nanometre', true)).not.toThrow();
  });

  it('refuse un paramètre host ou hostaddr, même si l’hôte affiché est local', () => {
    const secret = 'mot-de-passe-secret';
    const bypass = `postgres://postgres:${secret}@localhost/db?host=db.x.supabase.co`;
    expect(() => assertDisposableDatabase(bypass, false)).toThrow(/paramètres host et hostaddr/);
    expect(() => assertDisposableDatabase(`postgres://postgres:${secret}@127.0.0.1/db?hostaddr=1.2.3.4`, false)).toThrow(/hostaddr/);
    expect(() => assertDisposableDatabase('postgres://postgres:postgres@127.0.0.1/db?host=127.0.0.1', false)).toThrow(/host/);
    try {
      assertDisposableDatabase(bypass, false);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(secret);
      expect(message).not.toContain('postgres://');
    }
  });

  it('ignore DATABASE_URL distant quand TEST_DATABASE_URL est local, et saute si rien n’est défini', () => {
    expect(resolveTestDatabase({})).toBeNull();
    expect(
      resolveTestDatabase({
        DATABASE_URL: 'postgres://postgres:secret@db.exemple.ca:5432/prod',
        TEST_DATABASE_URL: 'postgres://postgres:postgres@127.0.0.1:5432/nanometre',
      }),
    ).toContain('127.0.0.1');
    expect(() => resolveTestDatabase({ DATABASE_URL: 'postgres://postgres:secret@aws-0.pooler.supabase.com:5432/postgres' })).toThrow(/Refus/);
  });
});
