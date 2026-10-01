import pg from 'npm:pg@8.16.3';
import Stripe from 'npm:stripe@18.5.0';
import { assertDisposableDatabase } from '../../../src/security/databaseGuard.ts';
import { STRIPE_API_VERSION } from '../_shared/payments.ts';
import { handleWebhookRequest, type WebhookAdmin, type WebhookRuntime } from './handler.ts';

const url = Deno.env.get('TEST_DATABASE_URL') || Deno.env.get('DATABASE_URL') || '';
if (url) {
  assertDisposableDatabase(url, Deno.env.get('ALLOW_DISPOSABLE_TEST_DB') === '1');
}

Deno.test('le refus Deno ne contient pas le mot de passe', () => {
  const secret = 'mot-de-passe-secret';
  try {
    assertDisposableDatabase(`postgres://postgres:${secret}@localhost/nanometre?host=db.x.supabase.co`, false);
    throw new Error('aurait dû refuser');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === 'aurait dû refuser' || message.includes(secret) || message.includes('postgres://')) {
      throw new Error(`fuite ou absence de refus: ${message}`);
    }
  }
});

const secret = `whsec_${'b'.repeat(32)}`;
const bookingId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const clientId = '11111111-1111-4111-8111-111111111111';
const barberId = '20000000-0000-4000-8000-000000000002';
const serviceId = '30000000-0000-4000-8000-000000000001';

function quoteIdent(value: string): string {
  if (!/^[a-z_]+$/.test(value)) {
    throw new Error(`Colonne refusée: ${value}`);
  }
  return value;
}

function postgresAdmin(connectionString: string): WebhookAdmin & { close: () => Promise<void>; raw: pg.Pool } {
  const pool = new pg.Pool({ connectionString });
  async function asService(sql: string, params: unknown[] = []) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      await client.query(`select set_config('request.jwt.claim.role', 'service_role', true)`);
      await client.query(`select set_config('request.jwt.claim.sub', '', true)`);
      await client.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`);
      await client.query('set local role service_role');
      const result = await client.query(sql, params);
      await client.query('commit');
      return result.rows as Record<string, unknown>[];
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }
  return {
    raw: pool,
    close: () => pool.end(),
    rpc: async (fn, args = {}) => {
      const keys = Object.keys(args);
      if (!/^[a-z_]+$/.test(fn)) {
        return { data: null, error: { message: 'Fonction refusée' } };
      }
      try {
        const rows = await asService(
          `select public.${fn}(${keys.map((_, index) => `$${index + 1}`).join(', ')}) as data`,
          keys.map((key) => args[key]),
        );
        return { data: rows[0]?.data ?? null, error: null };
      } catch (error) {
        return { data: null, error: { message: error instanceof Error ? error.message : 'sql' } };
      }
    },
    from(table: string) {
      if (!['bookings', 'payments', 'audit_log'].includes(table)) {
        throw new Error(table);
      }
      let operation: 'select' | 'update' = 'select';
      let columns = '*';
      let row: Record<string, unknown> = {};
      const filters: [string, unknown][] = [];
      const exec = async () => {
        if (operation === 'update') {
          const keys = Object.keys(row);
          const sets = keys.map((key, index) => `${quoteIdent(key)} = $${index + 1}`).join(', ');
          const where = filters.map((filter, index) => `${quoteIdent(filter[0])} = $${keys.length + index + 1}`).join(' and ');
          await asService(`update public.${table} set ${sets} where ${where}`, [...keys.map((key) => row[key]), ...filters.map((filter) => filter[1])]);
          return { data: null, error: null };
        }
        if (!/^[a-z_, ]+$/.test(columns)) {
          throw new Error(columns);
        }
        const where = filters.map((filter, index) => `${quoteIdent(filter[0])} = $${index + 1}`).join(' and ');
        const rows = await asService(`select ${columns} from public.${table} where ${where} limit 1`, filters.map((filter) => filter[1]));
        return { data: rows[0] ?? null, error: null };
      };
      const builder = {
        select(value: string) {
          columns = value;
          return builder;
        },
        update(value: Record<string, unknown>) {
          operation = 'update';
          row = value;
          return builder;
        },
        insert(value: Record<string, unknown>) {
          const keys = Object.keys(value);
          const cols = keys.map(quoteIdent).join(', ');
          const vals = keys.map((key, index) => (value[key] !== null && typeof value[key] === 'object' ? `$${index + 1}::jsonb` : `$${index + 1}`)).join(', ');
          const params = keys.map((key) => (value[key] !== null && typeof value[key] === 'object' ? JSON.stringify(value[key]) : value[key]));
          return asService(`insert into public.${table} (${cols}) values (${vals})`, params).then(() => ({ data: null, error: null }));
        },
        eq(column: string, value: unknown) {
          filters.push([column, value]);
          return builder;
        },
        maybeSingle() {
          return exec();
        },
        then(onFulfilled: (value: { data: unknown; error: null }) => unknown, onRejected?: (error: unknown) => unknown) {
          return exec().then(onFulfilled, onRejected);
        },
      };
      return builder;
    },
  };
}

Deno.test({
  name: 'le point d’entrée Deno rejoue un webhook après un échec Stripe, sur la vraie base',
  ignore: !url,
  async fn() {
    const admin = postgresAdmin(url);
    const stripe = new Stripe('sk_test_51NanometreDeno', {
      apiVersion: STRIPE_API_VERSION,
      httpClient: Stripe.createFetchHttpClient(),
    });
    let refunds = 0;
    stripe.refunds.create = (async () => {
      refunds += 1;
      if (refunds === 1) {
        throw new Error('stripe down');
      }
      return { id: 're_deno' };
    }) as typeof stripe.refunds.create;
    try {
      await admin.raw.query(`delete from public.stripe_events where id in ('evt_deno_retry', 'evt_deno_busy')`);
      await admin.raw.query(`delete from public.bookings where id = $1`, [bookingId]);
      await admin.raw.query(
        `insert into public.bookings (
          id, client_id, client_name, barber_id, service_id, starts_at, ends_at, duration_minutes,
          price_cents, gst_cents, qst_cents, total_cents, payment_method, status
        ) values (
          $1, $2, 'Alex Gagnon', $3, $4, now() + interval '40 hours', now() + interval '41 hours', 30,
          3500, 175, 349, 4024, 'en_ligne', 'annule'
        )`,
        [bookingId, clientId, barberId, serviceId],
      );
      await admin.raw.query(
        `insert into public.payments (booking_id, method, status, amount_cents, stripe_payment_intent_id)
         values ($1, 'en_ligne', 'echoue', 4024, 'pi_deno')`,
        [bookingId],
      );
      const payload = JSON.stringify({
        id: 'evt_deno_retry',
        object: 'event',
        api_version: STRIPE_API_VERSION,
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: 'pi_deno',
            object: 'payment_intent',
            amount_received: 4024,
            currency: 'cad',
            metadata: { bookingId },
          },
        },
      });
      const signature = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret });
      const runtime: WebhookRuntime = { stripeSecret: 'sk_test_51NanometreDeno', webhookSecret: secret, admin, stripe };
      const request = () =>
        new Request('http://127.0.0.1/stripe-webhook', {
          method: 'POST',
          headers: { 'stripe-signature': signature },
          body: payload,
        });
      const first = await handleWebhookRequest(request(), runtime);
      if (first.status !== 500) {
        throw new Error(`première livraison ${first.status}: ${await first.text()}`);
      }
      const missing = await admin.raw.query(`select count(*)::int as n from public.stripe_events where id = 'evt_deno_retry'`);
      if (missing.rows[0].n !== 0) {
        throw new Error('l’échec a laissé l’événement marqué');
      }
      const second = await handleWebhookRequest(request(), runtime);
      if (second.status !== 200) {
        throw new Error(`relivraison ${second.status}: ${await second.text()}`);
      }
      const kept = await admin.raw.query(`select status from public.stripe_events where id = 'evt_deno_retry'`);
      if (kept.rows[0]?.status !== 'traite') {
        throw new Error(`statut inattendu ${kept.rows[0]?.status}`);
      }
      const third = await handleWebhookRequest(request(), runtime);
      const body = await third.json();
      if (third.status !== 200 || body.duplicate !== true || refunds !== 2) {
        throw new Error(`doublon inattendu ${third.status} ${JSON.stringify(body)} remboursements=${refunds}`);
      }
      await admin.raw.query(
        `insert into public.stripe_events (id, status, updated_at) values ('evt_deno_busy', 'en_cours', now())`,
      );
      const busyPayload = payload.replace('evt_deno_retry', 'evt_deno_busy');
      const busySignature = await stripe.webhooks.generateTestHeaderStringAsync({ payload: busyPayload, secret });
      const busy = await handleWebhookRequest(
        new Request('http://127.0.0.1/stripe-webhook', {
          method: 'POST',
          headers: { 'stripe-signature': busySignature },
          body: busyPayload,
        }),
        runtime,
      );
      if (busy.status !== 503) {
        throw new Error(`bail ${busy.status}: ${await busy.text()}`);
      }
      if (refunds !== 2) {
        throw new Error('le bail a relancé un remboursement');
      }
      const still = await admin.raw.query(`select status from public.stripe_events where id = 'evt_deno_busy'`);
      if (still.rows[0]?.status !== 'en_cours') {
        throw new Error(`le bail a été clos: ${still.rows[0]?.status}`);
      }
    } finally {
      await admin.raw.query(`delete from public.bookings where id = $1`, [bookingId]);
      await admin.raw.query(`delete from public.stripe_events where id in ('evt_deno_retry', 'evt_deno_busy')`);
      await admin.close();
    }
  },
});
