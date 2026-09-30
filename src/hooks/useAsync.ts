import { useCallback, useEffect, useState } from 'react';
import { useAppState } from '../providers/AppState';
import type { Repository } from '../data/types';

export function useAsync<T>(factory: (repo: Repository) => Promise<T>, deps: readonly unknown[] = []) {
  const { repo, ready, version } = useAppState();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!ready) {
      return;
    }
    setStatus('loading');
    setError(null);
    factory(repo)
      .then((value) => {
        setData(value);
        setStatus('ready');
      })
      .catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'Une erreur est survenue.');
        setStatus('error');
      });
    // Les dépendances d'écran sont passées explicitement.
    // eslint-disable-next-line react-hooks/exhaustive-deps, react-hooks/use-memo
  }, [repo, ready, version, ...deps]);

  useEffect(() => {
    reload();
  }, [reload]);

  return { status: ready ? status : 'loading', data, error, reload };
}
