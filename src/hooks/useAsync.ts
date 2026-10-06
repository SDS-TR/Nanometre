import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppState } from '../providers/AppState';
import type { Repository } from '../data/types';

export function useAsync<T>(factory: (repo: Repository) => Promise<T>, deps: readonly unknown[] = []) {
  const { repo, ready, version } = useAppState();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const ticket = useRef(0);
  const hasData = useRef(false);

  const reload = useCallback(() => {
    if (!ready) {
      return;
    }
    const current = ++ticket.current;
    setRefreshing(true);
    if (!hasData.current) {
      setStatus('loading');
    }
    setError(null);
    factory(repo)
      .then((value) => {
        if (current !== ticket.current) {
          return;
        }
        hasData.current = true;
        setData(value);
        setStatus('ready');
        setRefreshing(false);
      })
      .catch((reason: unknown) => {
        if (current !== ticket.current) {
          return;
        }
        setError(reason instanceof Error ? reason.message : 'Une erreur est survenue.');
        setStatus(hasData.current ? 'ready' : 'error');
        setRefreshing(false);
      });
    // Les dépendances d'écran sont passées explicitement.
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/use-memo
  }, [repo, ready, version, ...deps]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { status: ready ? status : 'loading', data, error, reload, refreshing };
}
