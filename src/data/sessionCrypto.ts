import { gcm } from '@noble/ciphers/aes';
import { bytesToUtf8, utf8ToBytes } from '@noble/ciphers/utils';

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/** AES-GCM en JavaScript pur : le tag refuse un texte modifié, sans WebCrypto. */
export async function encryptSession(key: Uint8Array, value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = gcm(key, iv).encrypt(utf8ToBytes(value));
  return `${bytesToHex(iv)}.${bytesToHex(cipher)}`;
}

export async function decryptSession(key: Uint8Array, value: string): Promise<string> {
  const [ivHex, cipherHex] = value.split('.');
  if (!ivHex || !cipherHex || ivHex.length !== 24) {
    throw new Error('Session illisible.');
  }
  const plain = gcm(key, hexToBytes(ivHex)).decrypt(hexToBytes(cipherHex));
  return bytesToUtf8(plain);
}

export function sessionKeyHex(key: Uint8Array): string {
  return bytesToHex(key);
}

export function sessionKeyBytes(hex: string): Uint8Array {
  return hexToBytes(hex);
}
