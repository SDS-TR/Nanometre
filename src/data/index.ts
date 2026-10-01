import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { assertRuntimeConfig } from '../lib/productionConfig';
import { LargeSecureStore } from './largeSecureStore';
import { createLocalRepository } from './localRepository';
import { createSupabaseRepository } from './supabaseRepository';
import type { KeyValueStore } from './storage';
import type { Repository } from './types';

const storage: KeyValueStore = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
};

let repository: Repository | null = null;
let supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  return supabase;
}

export function getRepository(): Repository {
  if (repository) {
    return repository;
  }
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const source = process.env.EXPO_PUBLIC_DATA_SOURCE;
  const dev = typeof __DEV__ === 'undefined' || __DEV__;
  assertRuntimeConfig({ dev, source, url, key });
  const useSupabase = source === 'supabase' || (source !== 'local' && Boolean(url && key));
  if (useSupabase) {
    if (!url || !key) {
      throw new Error('EXPO_PUBLIC_SUPABASE_URL et EXPO_PUBLIC_SUPABASE_ANON_KEY sont requis.');
    }
    supabase = createClient(url, key, {
      auth: {
        storage: Platform.OS === 'web' ? undefined : new LargeSecureStore(),
        flowType: 'pkce',
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: typeof window !== 'undefined',
      },
    });
    repository = createSupabaseRepository(supabase);
    return repository;
  }
  repository = createLocalRepository(storage);
  return repository;
}

export type { Repository } from './types';
