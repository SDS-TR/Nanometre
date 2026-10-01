import { decryptSession, encryptSession, sessionKeyBytes, sessionKeyHex } from './sessionCrypto';

export type SlotMemory = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

export type SlotSecure = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  deleteItem: (key: string) => Promise<void>;
};

const generationKey = (key: string) => `${key}__gen`;
const cipherKey = (key: string, generation: number) => `${key}__c__${generation}`;
const secretKey = (key: string, generation: number) => `${key}__k__${generation}`;

async function discard(key: string, generation: number, memory: SlotMemory, secure: SlotSecure): Promise<void> {
  if (generation <= 0) {
    return;
  }
  await memory.removeItem(cipherKey(key, generation));
  await secure.deleteItem(secretKey(key, generation)).catch(() => undefined);
}

async function readGeneration(key: string, memory: SlotMemory): Promise<number> {
  const raw = await memory.getItem(generationKey(key));
  const generation = Number(raw);
  return Number.isInteger(generation) && generation > 0 ? generation : 0;
}

/** Lit la session active. Un créneau complet non publié est promu ; un créneau incomplet est effacé. */
export async function readSession(key: string, memory: SlotMemory, secure: SlotSecure): Promise<string | null> {
  let generation = await readGeneration(key, memory);
  const pending = generation + 1;
  const pendingCipher = await memory.getItem(cipherKey(key, pending));
  const pendingSecret = await secure.getItem(secretKey(key, pending));
  if (pendingCipher && pendingSecret) {
    try {
      const plain = await decryptSession(sessionKeyBytes(pendingSecret), pendingCipher);
      await memory.setItem(generationKey(key), String(pending));
      await discard(key, generation, memory, secure);
      return plain;
    } catch {
      await memory.removeItem(cipherKey(key, pending));
      await secure.deleteItem(secretKey(key, pending)).catch(() => undefined);
    }
  } else if (pendingCipher) {
    await memory.removeItem(cipherKey(key, pending));
  } else if (pendingSecret) {
    await secure.deleteItem(secretKey(key, pending)).catch(() => undefined);
  }
  if (generation > 1) {
    await discard(key, generation - 1, memory, secure);
  }
  if (generation > 0) {
    const cipher = await memory.getItem(cipherKey(key, generation));
    const secret = await secure.getItem(secretKey(key, generation));
    if (!cipher || !secret) {
      return null;
    }
    return decryptSession(sessionKeyBytes(secret), cipher);
  }
  const legacyCipher = await memory.getItem(key);
  const legacySecret = await secure.getItem(key);
  if (!legacyCipher || !legacySecret) {
    return null;
  }
  return decryptSession(sessionKeyBytes(legacySecret), legacyCipher);
}

/**
 * Écrit le texte et la clé dans un nouveau créneau, puis publie ce créneau.
 * Un arrêt avant la publication laisse l’ancienne session lisible.
 */
export async function writeSession(key: string, value: string, memory: SlotMemory, secure: SlotSecure): Promise<void> {
  const generation = await readGeneration(key, memory);
  const next = generation + 1;
  const secret = crypto.getRandomValues(new Uint8Array(32));
  const cipher = await encryptSession(secret, value);
  await memory.setItem(cipherKey(key, next), cipher);
  try {
    await secure.setItem(secretKey(key, next), sessionKeyHex(secret));
  } catch (error) {
    await memory.removeItem(cipherKey(key, next));
    throw error;
  }
  await memory.setItem(generationKey(key), String(next));
  await discard(key, generation, memory, secure);
  await memory.removeItem(key);
  await secure.deleteItem(key).catch(() => undefined);
}

export async function removeSession(key: string, memory: SlotMemory, secure: SlotSecure): Promise<void> {
  const generation = await readGeneration(key, memory);
  await memory.removeItem(generationKey(key));
  await memory.removeItem(key);
  await discard(key, generation, memory, secure);
  await discard(key, generation + 1, memory, secure);
  await secure.deleteItem(key).catch(() => undefined);
}
