const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function databaseHost(url: string): string {
  const normalized = url.replace(/^postgres(?:ql)?:\/\//i, 'http://');
  let hostname = '';
  try {
    hostname = new URL(normalized).hostname;
  } catch {
    throw new Error('URL de base de test illisible. Rien n’a été effacé.');
  }
  return hostname.replace(/^\[|\]$/g, '');
}

/** Refuse de détruire une base qui n’est pas locale, sauf drapeau explicite. */
export function assertDisposableDatabase(url: string, allowRemote = false): void {
  const host = databaseHost(url);
  if (LOCAL_HOSTS.has(host) || allowRemote) {
    return;
  }
  throw new Error(
    `Refus de réinitialiser ${host}. Cette suite efface les schémas public et auth. Elle n’accepte que localhost, 127.0.0.1 ou ::1, ou ALLOW_DISPOSABLE_TEST_DB=1 sur une base jetable.`,
  );
}

export function resolveTestDatabase(env?: Record<string, string | undefined>): string | null {
  const source = env ?? process.env;
  const url = source.TEST_DATABASE_URL || source.DATABASE_URL || '';
  if (!url) {
    return null;
  }
  assertDisposableDatabase(url, source.ALLOW_DISPOSABLE_TEST_DB === '1');
  return url;
}
