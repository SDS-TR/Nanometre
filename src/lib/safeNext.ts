/** N'accepte qu'un chemin interne. Refuse //, les URL absolues et les schémas. */
export function safeNext(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) {
    return '/';
  }
  if (value.includes('://') || value.includes('\\')) {
    return '/';
  }
  return value;
}
