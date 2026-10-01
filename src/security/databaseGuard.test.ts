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
