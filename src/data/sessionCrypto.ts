import aesjs from 'aes-js';

export function encryptSession(key: Uint8Array, value: string): string {
  const ctr = new aesjs.ModeOfOperation.ctr(key, new aesjs.Counter(1));
  return aesjs.utils.hex.fromBytes(ctr.encrypt(aesjs.utils.utf8.toBytes(value)));
}

export function decryptSession(key: Uint8Array, value: string): string {
  const ctr = new aesjs.ModeOfOperation.ctr(key, new aesjs.Counter(1));
  return aesjs.utils.utf8.fromBytes(ctr.decrypt(aesjs.utils.hex.toBytes(value)));
}
