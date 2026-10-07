/** Le plancher vient du serveur. Sans valeur distante, le binaire n’est pas bloqué par sa propre config. */
export function blockedByRemoteFloor(current: string, remoteMinimum: string | null | undefined): boolean {
  if (!remoteMinimum) {
    return false;
  }
  return versionBelow(current, remoteMinimum);
}

/** Compare des versions `1.2.3`. Un binaire plus ancien que le minimum doit se mettre à jour. */
export function versionBelow(current: string, minimum: string): boolean {
  const left = current.split('.').map((part) => Number(part) || 0);
  const right = minimum.split('.').map((part) => Number(part) || 0);
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a < b) {
      return true;
    }
    if (a > b) {
      return false;
    }
  }
  return false;
}
