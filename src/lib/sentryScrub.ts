const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const BEARER = /bearer\s+\S+/gi;
const TOKEN = /\b(?:eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|sk_(?:live|test)_[A-Za-z0-9]+)\b/g;

const SENSITIVE_KEY =
  /^(email|e-mail|phone|courriel|telephone|téléphone|name|fullname|full_name|client_name|clientname|note|notes|token|access_token|refresh_token|authorization|password|secret)$/i;

export function scrubPersonal(value: string): string {
  return value
    .replace(UUID, '[id]')
    .replace(EMAIL, '[courriel]')
    .replace(PHONE, '[téléphone]')
    .replace(BEARER, 'bearer [jeton]')
    .replace(TOKEN, '[jeton]');
}

/** Chemin seul : la query d’une URL REST contient souvent un identifiant. */
export function stripUrlQuery(url: string): string {
  const withoutHash = url.split('#')[0] ?? url;
  const query = withoutHash.indexOf('?');
  return query === -1 ? withoutHash : withoutHash.slice(0, query);
}

export function scrubUnknown(value: unknown): unknown {
  if (typeof value === 'string') {
    return scrubPersonal(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubUnknown(item));
  }
  if (value && typeof value === 'object') {
    const copy: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) {
        copy[key] = '[retiré]';
      } else if (key === 'url' && typeof item === 'string') {
        copy[key] = stripUrlQuery(scrubPersonal(item));
      } else {
        copy[key] = scrubUnknown(item);
      }
    }
    return copy;
  }
  return value;
}

type ExceptionValue = {
  type?: string;
  value?: string;
  stacktrace?: { frames?: unknown[] };
};

type SentryEvent = {
  message?: string;
  exception?: { values?: ExceptionValue[] };
  request?: { url?: string; headers?: Record<string, string> };
  breadcrumbs?: { category?: string; message?: string; data?: Record<string, unknown> }[];
};

/**
 * Nettoie un événement JS. Un message sans pile (réponse serveur) devient un code :
 * la phrase peut contenir des noms. La pile d’une exception locale est conservée.
 */
export function scrubEvent<T extends SentryEvent>(event: T): T {
  const copy = scrubUnknown(event) as T;
  if (copy.request?.url) {
    copy.request.url = stripUrlQuery(copy.request.url);
  }
  if (copy.request?.headers) {
    for (const key of Object.keys(copy.request.headers)) {
      if (/authorization|cookie|apikey/i.test(key)) {
        copy.request.headers[key] = '[retiré]';
      }
    }
  }
  if (copy.message && !copy.exception?.values?.some((item) => (item.stacktrace?.frames?.length ?? 0) > 0)) {
    copy.message = 'erreur-serveur';
  }
  for (const item of copy.exception?.values ?? []) {
    const frames = item.stacktrace?.frames?.length ?? 0;
    if (item.value) {
      item.value = frames > 0 ? scrubPersonal(item.value) : 'erreur-serveur';
    }
  }
  if (copy.breadcrumbs) {
    copy.breadcrumbs = copy.breadcrumbs
      .filter((crumb) => crumb.category !== 'console')
      .map((crumb) => {
        if (crumb.data && typeof crumb.data.url === 'string') {
          crumb.data.url = stripUrlQuery(crumb.data.url);
        }
        return crumb;
      });
  }
  return copy;
}

export function scrubBreadcrumb<T extends { category?: string; data?: { url?: string } }>(breadcrumb: T): T | null {
  if (breadcrumb.category === 'console') {
    return null;
  }
  const copy = scrubUnknown(breadcrumb) as T;
  if (copy.data && typeof copy.data.url === 'string') {
    copy.data.url = stripUrlQuery(copy.data.url);
  }
  return copy;
}
