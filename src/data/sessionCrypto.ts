function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function asBuffer(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  copy.set(bytes);
  return copy;
}

async function aesKey(key: Uint8Array, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', asBuffer(key), 'AES-GCM', false, [usage]);
}

/** AES-GCM : le tag d'authentification refuse un texte modifié. */
export async function encryptSession(key: Uint8Array, value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cryptoKey = await aesKey(key, 'encrypt');
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, new TextEncoder().encode(value));
  return `${bytesToHex(iv)}.${bytesToHex(new Uint8Array(cipher))}`;
}

export async function decryptSession(key: Uint8Array, value: string): Promise<string> {
  const [ivHex, cipherHex] = value.split('.');
  if (!ivHex || !cipherHex) {
    throw new Error('Session illisible.');
  }
  const cryptoKey = await aesKey(key, 'decrypt');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: hexToBytes(ivHex) }, cryptoKey, hexToBytes(cipherHex));
  return new TextDecoder().decode(plain);
}

export function sessionKeyHex(key: Uint8Array): string {
  return bytesToHex(key);
}

export function sessionKeyBytes(hex: string): Uint8Array {
  return hexToBytes(hex);
}
