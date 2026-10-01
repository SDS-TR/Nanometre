import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import 'react-native-get-random-values';
import { decryptSession, encryptSession, sessionKeyBytes, sessionKeyHex } from './sessionCrypto';

/** Clé AES dans le trousseau, session chiffrée dans AsyncStorage (SecureStore plafonne vers 2 Ko). */
export class LargeSecureStore {
  async getItem(key: string): Promise<string | null> {
    try {
      const stored = await AsyncStorage.getItem(key);
      if (!stored) {
        return null;
      }
      const encKeyHex = await SecureStore.getItemAsync(key);
      if (!encKeyHex) {
        return null;
      }
      return await decryptSession(sessionKeyBytes(encKeyHex), stored);
    } catch {
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    const encKey = crypto.getRandomValues(new Uint8Array(32));
    const cipher = await encryptSession(encKey, value);
    await AsyncStorage.setItem(key, cipher);
    try {
      await SecureStore.setItemAsync(key, sessionKeyHex(encKey), {
        keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
      });
    } catch (error) {
      await AsyncStorage.removeItem(key);
      throw error;
    }
  }

  async removeItem(key: string): Promise<void> {
    await AsyncStorage.removeItem(key);
    await SecureStore.deleteItemAsync(key);
  }
}
