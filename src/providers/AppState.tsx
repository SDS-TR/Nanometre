import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getRepository } from '../data';
import type { Repository, SessionUser } from '../data/types';
import { getThemePreference, setThemePreference, type ThemePreference } from '../theme';

const THEME_KEY = 'lenanometre.theme';

type AppState = {
  repo: Repository;
  user: SessionUser | null;
  ready: boolean;
  version: number;
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
};

const Context = createContext<AppState | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [repo] = useState(() => getRepository());
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);
  const [version, setVersion] = useState(0);
  const [preference, setPreferenceState] = useState<ThemePreference>(getThemePreference());

  useEffect(() => {
    let alive = true;
    repo.ready
      .then(async () => {
        const stored = await AsyncStorage.getItem(THEME_KEY);
        if (stored === 'sombre' || stored === 'clair' || stored === 'systeme') {
          setThemePreference(stored);
          if (alive) {
            setPreferenceState(stored);
          }
        }
        if (alive) {
          setUser(repo.getSession());
          setReady(true);
        }
      })
      .catch(() => {
        if (alive) {
          setReady(true);
        }
      });
    const unsubscribe = repo.subscribe(() => {
      setUser(repo.getSession());
      setVersion((current) => current + 1);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [repo]);

  function setPreference(next: ThemePreference) {
    setThemePreference(next);
    setPreferenceState(next);
    void AsyncStorage.setItem(THEME_KEY, next);
  }

  return <Context.Provider value={{ repo, user, ready, version, preference, setPreference }}>{children}</Context.Provider>;
}

export function useAppState(): AppState {
  const value = useContext(Context);
  if (!value) {
    throw new Error('useAppState doit être utilisé dans AppStateProvider');
  }
  return value;
}
