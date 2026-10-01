import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import 'react-native-get-random-values';
import { readSession, removeSession, writeSession, type SlotMemory, type SlotSecure } from './sessionSlots';

const memory: SlotMemory = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
};

const secure: SlotSecure = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) =>
    SecureStore.setItemAsync(key, value, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    }),
  deleteItem: (key) => SecureStore.deleteItemAsync(key),
};

/** Clé AES dans le trousseau, session chiffrée dans AsyncStorage (SecureStore plafonne vers 2 Ko). */
export class LargeSecureStore {
  async getItem(key: string): Promise<string | null> {
    try {
      return await readSession(key, memory, secure);
    } catch {
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    await writeSession(key, value, memory, secure);
  }

  async removeItem(key: string): Promise<void> {
    await removeSession(key, memory, secure);
  }
}
