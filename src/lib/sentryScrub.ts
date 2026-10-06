const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/g;

export function scrubPersonal(value: string): string {
  return value.replace(EMAIL, '[courriel]').replace(PHONE, '[téléphone]');
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
      if (/email|phone|courriel|téléphone|telephone/i.test(key)) {
        copy[key] = '[retiré]';
      } else {
        copy[key] = scrubUnknown(item);
      }
    }
    return copy;
  }
  return value;
}
