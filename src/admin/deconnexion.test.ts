import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { confirmerPuisDeconnecter, deconnecter } from './deconnexion';
import { createLocalRepository } from '../data/localRepository';
import { createSupabaseRepository } from '../data/supabaseRepository';
import { readSession, removeSession, writeSession, type SlotMemory, type SlotSecure } from '../data/sessionSlots';
import { memoryStore } from '../data/storage';

const ROLES = [
  ['propriétaire', 'karim@lenanometre.ca'],
  ['coiffeur', 'julien.morel@lenanometre.ca'],
] as const;

describe('déconnexion admin', () => {
  it('ferme la session du propriétaire et du coiffeur, puis renvoie vers la connexion', async () => {
    for (const [, email] of ROLES) {
      const data = createLocalRepository(memoryStore());
      await data.ready;
      await data.signIn(email, 'nanometre');
      expect(data.getSession()).not.toBeNull();
      const routes: string[] = [];
      await deconnecter(data, (path) => {
        routes.push(path);
      });
      expect(data.getSession()).toBeNull();
      expect(routes).toEqual(['/connexion']);
      await data.signIn('alex.gagnon@exemple.ca', 'nanometre');
      expect(data.getSession()?.role).toBe('client');
    }
  });

  it('laisse la session en place si la confirmation est refusée', async () => {
    const data = createLocalRepository(memoryStore());
    await data.ready;
    await data.signIn('karim@lenanometre.ca', 'nanometre');
    const routes: string[] = [];
    await confirmerPuisDeconnecter(
      () => false,
      data,
      (path) => {
        routes.push(path);
      },
    );
    expect(data.getSession()?.email).toBe('karim@lenanometre.ca');
    expect(routes).toEqual([]);
  });

  it('efface la session chiffrée quand le mode supabase se déconnecte', async () => {
    const memory = new Map<string, string>();
    const secrets = new Map<string, string>();
    const asyncStore: SlotMemory = {
      getItem: async (key) => memory.get(key) ?? null,
      setItem: async (key, value) => {
        memory.set(key, value);
      },
      removeItem: async (key) => {
        memory.delete(key);
      },
    };
    const secure: SlotSecure = {
      getItem: async (key) => secrets.get(key) ?? null,
      setItem: async (key, value) => {
        secrets.set(key, value);
      },
      deleteItem: async (key) => {
        secrets.delete(key);
      },
    };
    const key = 'sb-projet-auth-token';
    await writeSession(key, 'jeton-secret', asyncStore, secure);
    expect(await readSession(key, asyncStore, secure)).toBe('jeton-secret');
    const supabase = {
      rpc: async () => ({ error: null }),
      auth: {
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
        signOut: async () => ({ error: { message: 'réseau coupé' } }),
      },
    } as unknown as SupabaseClient;
    const repo = createSupabaseRepository(supabase, {
      key,
      removeItem: (item) => removeSession(item, asyncStore, secure),
    });
    const routes: string[] = [];
    await deconnecter(repo, (path) => {
      routes.push(path);
    });
    expect(routes).toEqual(['/connexion']);
    expect(repo.getSession()).toBeNull();
    expect(await readSession(key, asyncStore, secure)).toBeNull();
    for (const value of memory.values()) {
      expect(value).not.toContain('jeton-secret');
    }
    expect(secrets.size).toBe(0);
  });
});
