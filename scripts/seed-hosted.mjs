import { spawnSync } from 'node:child_process';

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error(
    'Définis SUPABASE_DB_URL (chaîne postgres du projet), puis relance.\n' +
      'En local, préfère : supabase db reset\n' +
      'Le script applique supabase/seed.sql, y compris les trois comptes de démo (mot de passe nanometre).',
  );
  process.exit(1);
}

const result = spawnSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-f', 'supabase/seed.sql'], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
