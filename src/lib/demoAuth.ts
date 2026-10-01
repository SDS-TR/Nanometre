export function demoLoginPrefill(mode: 'local' | 'supabase', dev: boolean): { email: string; password: string } {
  if (mode === 'local' && dev) {
    return { email: 'alex.gagnon@exemple.ca', password: 'nanometre' };
  }
  return { email: '', password: '' };
}
