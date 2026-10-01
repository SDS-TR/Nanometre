const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

function parsedDatabaseUrl(url: string): URL {
  const normalized = url.replace(/^postgres(?:ql)?:\/\//i, 'http://');
  try {
    return new URL(normalized);
  } catch {
    throw new Error('URL de base de test illisible. Rien n’a été effacé.');
  }
}

export function databaseHost(url: string): string {
  return parsedDatabaseUrl(url).hostname.replace(/^\[|\]$/g, '');
}

function hasHostOverride(url: string): boolean {
  const params = parsedDatabaseUrl(url).searchParams;
  for (const key of params.keys()) {
    const name = key.toLowerCase();
    if (name === 'host' || name === 'hostaddr') {
      return true;
    }
  }
  return false;
}

/** Refuse de détruire une base qui n’est pas locale, sauf drapeau explicite. */
export function assertDisposableDatabase(url: string, allowRemote = false): void {
  if (allowRemote) {
    return;
  }
  if (hasHostOverride(url)) {
    throw new Error(
      'Refus de réinitialiser : les paramètres host et hostaddr peuvent rediriger la connexion. Rien n’a été effacé.',
    );
  }
  const host = databaseHost(url);
  if (LOCAL_HOSTS.has(host)) {
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
