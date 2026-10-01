import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { remotePushSupported } from './pushAvailability';

const root = fileURLToPath(new URL('../..', import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    if (statSync(path).isDirectory()) {
      if (name === 'node_modules' || name === '.expo') {
        return [];
      }
      return sourceFiles(path);
    }
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('notifications dans Expo Go', () => {
  it('reste inactif dans Expo Go et actif dans un build de développement ou EAS', () => {
    expect(remotePushSupported({ runningInExpoGo: true })).toBe(false);
    expect(remotePushSupported({ runningInExpoGo: false })).toBe(true);
  });

  it('n’importe expo-notifications qu’après le contrôle Expo Go', () => {
    const eager = sourceFiles(root)
      .filter((path) => /from ['"]expo-notifications['"]/.test(readFileSync(path, 'utf8')))
      .map((path) => path.slice(root.length).replaceAll('\\', '/'));
    expect(eager).toEqual([]);
    const native = readFileSync(fileURLToPath(new URL('./push.native.ts', import.meta.url)), 'utf8');
    const guard = native.indexOf('isRunningInExpoGo()');
    const load = native.indexOf("await import('expo-notifications')");
    expect(guard).toBeGreaterThan(-1);
    expect(load).toBeGreaterThan(guard);
  });
});
