import { spawnSync } from 'node:child_process';

const url = process.env.SUPABASE_DB_URL;
if (!url) {
  console.error(
    'Définis SUPABASE_DB_URL, puis relance.\n' +
      'En local : supabase db reset (catalogue + comptes de démo).\n' +
      'Ce script n’insère jamais les comptes de démo, même avec ALLOW_DEMO_ACCOUNTS.',
  );
  process.exit(1);
}

let host = '';
try {
  host = new URL(url.replace(/^postgres(ql)?:/, 'http:')).hostname;
} catch {
  host = '';
}
const local = host === 'localhost' || host === '127.0.0.1' || host === '::1';
if (!local) {
  console.error(
    'Refus : ce script ne s’exécute pas sur un projet hébergé.\n' +
      'Les comptes alex.gagnon@exemple.ca, karim@lenanometre.ca et julien.morel@lenanometre.ca restent locaux.\n' +
      'S’ils existent déjà sur le projet, supprime-les et révoque leurs sessions.',
  );
  process.exit(1);
}

if (process.env.ALLOW_DEMO_ACCOUNTS === '1') {
  console.error('ALLOW_DEMO_ACCOUNTS est ignoré : les comptes de démo ne sont jamais créés par ce script.');
  process.exit(1);
}

const result = spawnSync('psql', [url, '-v', 'ON_ERROR_STOP=1', '-f', 'supabase/seed.sql'], {
  stdio: 'inherit',
});
process.exit(result.status ?? 1);
