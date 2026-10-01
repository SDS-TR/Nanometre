export function assertRuntimeConfig(env: {
  dev: boolean;
  source: string | undefined;
  url: string | undefined;
  key: string | undefined;
}): void {
  if (env.dev || env.source === 'local') {
    return;
  }
  if (env.source !== 'supabase' || !env.url || !env.key) {
    throw new Error('Configuration de production incomplète.');
  }
}
