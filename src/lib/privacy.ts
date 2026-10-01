/** « Alex Gagnon » devient « Alex G. ». Un seul mot reste tel quel. */
export function maskClientName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return 'Client';
  }
  if (parts.length === 1) {
    return parts[0] ?? 'Client';
  }
  const initial = parts[1]?.charAt(0);
  return initial ? `${parts[0]} ${initial}.` : (parts[0] ?? 'Client');
}
