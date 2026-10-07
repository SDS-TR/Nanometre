import { describe, expect, it } from 'vitest';
import { markPushClearPending, PUSH_CLEAR_KEY, resumePushClear } from './pushClear';

function memory() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: async (key: string) => values.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: async (key: string) => {
      values.delete(key);
    },
  };
}

describe('jeton push à la déconnexion', () => {
  it('retente clear_my_push_tokens seulement après un échec', async () => {
    const store = memory();
    await markPushClearPending(store, false);
    let calls = 0;
    await resumePushClear(store, async () => {
      calls += 1;
      return { error: null };
    });
    expect(calls).toBe(0);

    await markPushClearPending(store, true);
    expect(store.values.get(PUSH_CLEAR_KEY)).toBe('1');
    await resumePushClear(store, async () => ({ error: { message: 'hors ligne' } }));
    expect(store.values.get(PUSH_CLEAR_KEY)).toBe('1');
    await resumePushClear(store, async () => ({ error: null }));
    expect(store.values.has(PUSH_CLEAR_KEY)).toBe(false);
  });
});
