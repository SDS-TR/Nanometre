import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { decryptSession, encryptSession, sessionKeyBytes, sessionKeyHex } from './sessionCrypto';
import { readSession, writeSession, type SlotMemory, type SlotSecure } from './sessionSlots';

function stores() {
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
  return { memory, secrets, asyncStore, secure };
}

describe('écriture de session en deux temps', () => {
  it('garde l’ancienne session si l’app meurt avant la clé, et publie le nouveau créneau s’il est complet', async () => {
    const { memory, secrets, asyncStore, secure } = stores();
    await writeSession('sb', 'session-ancienne', asyncStore, secure);
    memory.set('sb__c__2', 'texte-orphelin');
    expect(await readSession('sb', asyncStore, secure)).toBe('session-ancienne');
    expect(memory.has('sb__c__2')).toBe(false);

    const secret = crypto.getRandomValues(new Uint8Array(32));
    memory.set('sb__c__2', await encryptSession(secret, 'session-nouvelle'));
    secrets.set('sb__k__2', sessionKeyHex(secret));
    expect(await readSession('sb', asyncStore, secure)).toBe('session-nouvelle');
    expect(memory.has('sb__c__1')).toBe(false);
    expect(secrets.has('sb__k__1')).toBe(false);
  });

  it('n’écrit pas le texte en clair et retire le créneau si le trousseau refuse la clé', async () => {
    const { memory, secrets, asyncStore, secure } = stores();
    await writeSession('sb', 'session-ancienne', asyncStore, secure);
    secure.setItem = async () => {
      throw new Error('appareil verrouillé');
    };
    await expect(writeSession('sb', 'session-nouvelle', asyncStore, secure)).rejects.toThrow(/verrouillé/);
    expect(await readSession('sb', asyncStore, secure)).toBe('session-ancienne');
    expect(memory.has('sb__c__2')).toBe(false);
    for (const value of memory.values()) {
      expect(value).not.toContain('session-ancienne');
      expect(value).not.toContain('session-nouvelle');
    }
    const stored = memory.get('sb__c__1');
    const key = secrets.get('sb__k__1');
    expect(stored && key).toBeTruthy();
    expect(await decryptSession(sessionKeyBytes(key!), stored!)).toBe('session-ancienne');
  });

  it('lit encore une session écrite avant les créneaux, puis n’en garde qu’une', async () => {
    const { memory, secrets, asyncStore, secure } = stores();
    const secret = crypto.getRandomValues(new Uint8Array(32));
    memory.set('sb', await encryptSession(secret, 'session-legacy'));
    secrets.set('sb', sessionKeyHex(secret));
    expect(await readSession('sb', asyncStore, secure)).toBe('session-legacy');
    await writeSession('sb', 'session-suivante', asyncStore, secure);
    expect(await readSession('sb', asyncStore, secure)).toBe('session-suivante');
    expect(memory.has('sb')).toBe(false);
    expect(secrets.has('sb')).toBe(false);
  });
});

describe('trousseau', () => {
  it('garde l’accessibilité après le premier déverrouillage', () => {
    const source = readFileSync(new URL('./largeSecureStore.ts', import.meta.url), 'utf8');
    expect(source).toContain('AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY');
    expect(source).toContain('writeSession');
  });
});
