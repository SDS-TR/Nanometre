export const PUSH_CLEAR_KEY = 'lenanometre.push-clear-pending';

type FlagStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

/** Mémorise un échec de clear_my_push_tokens pour le retenter à la prochaine connexion. */
export async function markPushClearPending(store: FlagStore, failed: boolean): Promise<void> {
  if (failed) {
    await store.setItem(PUSH_CLEAR_KEY, '1');
    return;
  }
  await store.removeItem(PUSH_CLEAR_KEY);
}

export async function resumePushClear(
  store: FlagStore,
  clear: () => PromiseLike<{ error: { message: string } | null }>,
): Promise<void> {
  if ((await store.getItem(PUSH_CLEAR_KEY)) !== '1') {
    return;
  }
  try {
    const result = await clear();
    if (!result.error) {
      await store.removeItem(PUSH_CLEAR_KEY);
    }
  } catch {
    await store.setItem(PUSH_CLEAR_KEY, '1');
  }
}
