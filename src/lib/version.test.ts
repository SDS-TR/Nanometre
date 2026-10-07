import { describe, expect, it } from 'vitest';
import { blockedByRemoteFloor, versionBelow } from './version';

describe('version minimale', () => {
  it('accepte la version courante et refuse une version plus ancienne', () => {
    expect(versionBelow('1.0.0', '1.0.0')).toBe(false);
    expect(versionBelow('1.2.0', '1.0.9')).toBe(false);
    expect(versionBelow('0.9.9', '1.0.0')).toBe(true);
    expect(versionBelow('1.0', '1.0.1')).toBe(true);
  });

  it('ne bloque que si le serveur publie un plancher plus récent', () => {
    expect(blockedByRemoteFloor('1.0.0', null)).toBe(false);
    expect(blockedByRemoteFloor('1.0.0', '1.0.0')).toBe(false);
    expect(blockedByRemoteFloor('1.0.0', '1.2.0')).toBe(true);
  });
});
