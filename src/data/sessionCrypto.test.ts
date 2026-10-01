import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decryptSession, encryptSession } from './sessionCrypto';

const source = readFileSync(new URL('./sessionCrypto.ts', import.meta.url), 'utf8');

describe('chiffrement de session sans WebCrypto', () => {
  it('fait l’aller-retour et refuse un texte modifié quand subtle est absent', async () => {
    expect(source).not.toContain('subtle');
    expect(source).toContain('@noble/ciphers/aes');
    const subtle = crypto.subtle;
    Object.defineProperty(crypto, 'subtle', { configurable: true, value: undefined });
    try {
      expect(crypto.subtle).toBeUndefined();
      const key = crypto.getRandomValues(new Uint8Array(32));
      const cipher = await encryptSession(key, '{"access_token":"secret"}');
      expect(cipher).not.toContain('secret');
      expect(await decryptSession(key, cipher)).toBe('{"access_token":"secret"}');
      const [iv, body] = cipher.split('.');
      const flipped = `${body.slice(0, -2)}${body.endsWith('00') ? 'ff' : '00'}`;
      await expect(decryptSession(key, `${iv}.${flipped}`)).rejects.toThrow();
    } finally {
      Object.defineProperty(crypto, 'subtle', { configurable: true, value: subtle });
    }
  });
});
