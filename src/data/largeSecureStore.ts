import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import 'react-native-get-random-values';
import aesjs from 'aes-js';
import { decryptSession, encryptSession } from './sessionCrypto';

/** Clé AES dans le trousseau, session chiffrée dans AsyncStorage (SecureStore plafonne vers 2 Ko). */
export class LargeSecureStore {
  async getItem(key: string): Promise<string | null> {
    const stored = await AsyncStorage.getItem(key);
    if (!stored) {
      return null;
    }
    const encKeyHex = await SecureStore.getItemAsync(key);
    if (!encKeyHex) {
      return null;
    }
    try {
      return decryptSession(aesjs.utils.hex.toBytes(encKeyHex), stored);
    } catch {
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    const encKey = crypto.getRandomValues(new Uint8Array(32));
    await SecureStore.setItemAsync(key, aesjs.utils.hex.fromBytes(encKey), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    await AsyncStorage.setItem(key, encryptSession(encKey, value));
  }

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(key);
  }
}
