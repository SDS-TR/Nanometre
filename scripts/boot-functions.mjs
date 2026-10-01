import { spawn } from 'node:child_process';
import { once } from 'node:events';

const functions = [
  ['supabase/functions/stripe-webhook/index.ts', 400],
  ['supabase/functions/dispatch-notifications/index.ts', 403],
  ['supabase/functions/expire-checkouts/index.ts', 403],
  ['supabase/functions/process-refunds/index.ts', 403],
  ['supabase/functions/purge-notes/index.ts', 403],
  ['supabase/functions/create-payment-intent/index.ts', 401],
  ['supabase/functions/process-refund/index.ts', 401],
  ['supabase/functions/delete-account/index.ts', 401],
  ['supabase/functions/abandon-checkout/index.ts', 401],
  ['supabase/functions/invite-team-member/index.ts', 401],
];

const env = {
  ...process.env,
  FUNCTION_PORT: '8711',
  STRIPE_SECRET_KEY: 'sk_test_boot',
  STRIPE_WEBHOOK_SECRET: 'whsec_boot',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_ANON_KEY: 'anon-boot',
  SUPABASE_SERVICE_ROLE_KEY: 'service-boot',
  CRON_SECRET: 'cron-secret-value',
};

async function boot([entry, expected]) {
  const child = spawn('deno', ['run', '--allow-env', '--allow-net', '--allow-read', entry], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`délai de démarrage\n${output}`)), 90000);
    const watch = () => {
      if (output.includes('Listening on')) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.stdout.on('data', watch);
    child.stderr.on('data', watch);
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`sortie ${code}\n${output}`));
    });
  });
  try {
    await ready;
    const response = await fetch('http://127.0.0.1:8711/', { method: 'POST' });
    if (response.status !== expected) {
      throw new Error(`${entry} a répondu ${response.status}, attendu ${expected}: ${await response.text()}`);
    }
    console.log(`${entry} ${response.status}`);
  } finally {
    child.kill('SIGTERM');
    await Promise.race([once(child, 'exit'), new Promise((resolve) => setTimeout(resolve, 2000))]);
    if (child.exitCode === null) {
      child.kill('SIGKILL');
    }
  }
}

for (const entry of functions) {
  await boot(entry);
}
