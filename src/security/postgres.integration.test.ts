import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';

const databaseUrl = process.env.DATABASE_URL;
const root = path.resolve(import.meta.dirname, '../..');
const clientId = '11111111-1111-4111-8111-111111111111';
const ownerId = '22222222-2222-4222-8222-222222222222';
const inviteeId = '44444444-4444-4444-8444-444444444444';
const barberId = '20000000-0000-4000-8000-000000000002';
const serviceId = '30000000-0000-4000-8000-000000000001';

type Claims = { sub?: string; aal?: string };

describe.skipIf(!databaseUrl)('politiques et RPC sur Postgres', () => {
  const pool = new pg.Pool({ connectionString: databaseUrl });

  beforeAll(async () => {
    const psql = (file: string) => {
      execFileSync('psql', [databaseUrl!, '-v', 'ON_ERROR_STOP=1', '-f', file], { stdio: 'pipe' });
    };
    execFileSync(
      'psql',
      [databaseUrl!, '-v', 'ON_ERROR_STOP=1', '-c', 'drop schema if exists public cascade; create schema public; drop schema if exists auth cascade;'],
      { stdio: 'pipe' },
    );
    psql(path.join(root, 'supabase/tests/bootstrap.sql'));
    const migrations = readdirSync(path.join(root, 'supabase/migrations'))
      .filter((name) => name.endsWith('.sql'))
      .sort();
    for (const name of migrations) {
      psql(path.join(root, 'supabase/migrations', name));
    }
    await pool.query(
      `insert into public.salon_settings (id, name, tagline, address, city, gst_number, qst_number, phone, onsite_late_policy)
       values (1, 'Le Nanomètre', 'Barbier', '425, rue Saint-Vallier Ouest', 'Québec', '123456789 RT0001', '1234567890 TQ0001', '418 555-0199', 'a_la_prochaine')`,
    );
    await pool.query(
      `insert into public.barbers (id, slug, full_name, short_name, specialty, bio, years, photo_path, sort_order)
       values ($1, 'julien-morel', 'Julien Morel', 'Julien', 'Coupe', 'Bio', 6, 'julien-morel', 2)`,
      [barberId],
    );
    await pool.query(
      `insert into public.services (id, slug, name, description, duration_minutes, price_cents, photo_path, sort_order)
       values ($1, 'coupe-classique', 'Coupe classique', 'Ciseaux', 30, 3500, 'coupe-classique', 1)`,
      [serviceId],
    );
    await insertUser(pool, clientId, 'alex.gagnon@exemple.ca', 'Alex Gagnon', 'client', null);
    await insertUser(pool, ownerId, 'karim@lenanometre.ca', 'Karim B.', 'proprietaire', barberId);
    await insertUser(pool, inviteeId, 'invite@exemple.ca', 'Invité', 'client', null);
    await pool.query(`update public.profiles set active = false, invited_at = now(), barber_id = null where id = $1`, [inviteeId]);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('refuse confirm_online_payment et les fonctions d’admin à anon', async () => {
    await expect(
      withRole(pool, 'authenticated', { sub: clientId }, (client) =>
        client.query(`select public.confirm_online_payment($1::uuid, 'pi_x', 1, 'cad')`, [clientId]),
      ),
    ).rejects.toThrow(/permission denied/i);
    for (const name of ['admin_cancel(uuid)', 'admin_dashboard(date, text)', 'admin_team()', 'apply_promo(uuid, text)', 'set_push_token(text)', 'enqueue_booking_notifications(uuid, text, text, text)']) {
      const allowed = await pool.query(`select has_function_privilege('anon', $1, 'execute') as ok`, [`public.${name}`]);
      expect(allowed.rows[0].ok).toBe(false);
    }
  });

  it('ne laisse à anon que le catalogue et la demande de suppression', async () => {
    const { rows } = await pool.query<{ proname: string }>(
      `select p.proname
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
       order by 1`,
    );
    expect(rows.map((row) => row.proname)).toEqual([
      'list_slots',
      'request_account_deletion',
      'salon_public',
      'visible_barbers',
      'visible_reviews',
      'visible_services',
    ]);
    await pool.query(`create or replace function public.later_probe() returns int language sql as $$ select 1 $$`);
    const created = await pool.query(`select has_function_privilege('anon', 'public.later_probe()', 'execute') as ok`);
    expect(created.rows[0].ok).toBe(false);
  });

  it('laisse un client lire son profil et empêche un propriétaire aal1 de changer un rôle', async () => {
    const visible = await withRole(pool, 'authenticated', { sub: clientId }, (client) =>
      client.query(`select id from public.profiles where id = $1`, [clientId]),
    );
    expect(visible.rows).toHaveLength(1);
    await expect(
      withRole(pool, 'authenticated', { sub: ownerId, aal: 'aal1' }, (client) =>
        client.query(`update public.profiles set role = 'proprietaire' where id = $1`, [clientId]),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      withRole(pool, 'authenticated', { sub: ownerId, aal: 'aal1' }, (client) =>
        client.query(`select public.admin_set_role($1::uuid, 'coiffeur')`, [clientId]),
      ),
    ).rejects.toThrow(/Vérification renforcée requise/);
  });

  it('refuse l’annulation d’un rendez-vous payé sans aal2 et pose un job avec aal2', async () => {
    const bookingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
    await pool.query(`delete from public.bookings where id = $1`, [bookingId]);
    await insertBooking(pool, { id: bookingId, clientId, method: 'en_ligne', status: 'confirme', pay: 'paye', intent: 'pi_paid', total: 6324, price: 5500, offsetHours: 3 });
    await expect(
      withRole(pool, 'authenticated', { sub: ownerId, aal: 'aal1' }, (client) =>
        client.query(`select public.admin_cancel($1::uuid)`, [bookingId]),
      ),
    ).rejects.toThrow(/Vérification renforcée requise/);
    await withRole(pool, 'authenticated', { sub: ownerId, aal: 'aal2' }, (client) =>
      client.query(`select public.admin_cancel($1::uuid)`, [bookingId]),
    );
    const job = await pool.query(`select amount_cents, status from public.refund_jobs where booking_id = $1`, [bookingId]);
    expect(job.rows[0].status).toBe('en_attente');
    expect(Number(job.rows[0].amount_cents)).toBeGreaterThan(0);
  });

  it('réactive une invitation une seule fois', async () => {
    await pool.query(`update auth.users set last_sign_in_at = now() where id = $1`, [inviteeId]);
    const first = await pool.query<{ active: boolean; invited_at: string | null }>(
      `select active, invited_at from public.profiles where id = $1`,
      [inviteeId],
    );
    expect(first.rows[0].active).toBe(true);
    expect(first.rows[0].invited_at).toBeNull();
    await withRole(pool, 'authenticated', { sub: ownerId, aal: 'aal2' }, (client) =>
      client.query(`select public.admin_set_active($1::uuid, false)`, [inviteeId]),
    );
    await pool.query(`update auth.users set last_sign_in_at = now() + interval '1 minute' where id = $1`, [inviteeId]);
    const second = await pool.query<{ active: boolean; invited_at: string | null }>(
      `select active, invited_at from public.profiles where id = $1`,
      [inviteeId],
    );
    expect(second.rows[0].active).toBe(false);
    expect(second.rows[0].invited_at).toBeNull();
  });

  it('bloque les codes promo après trente tentatives enregistrées', async () => {
    await pool.query(`delete from public.promo_attempts where user_id = $1`, [clientId]);
    let last: { ok?: boolean; error?: string } = {};
    await withRole(pool, 'authenticated', { sub: clientId }, async (client) => {
      for (let index = 0; index < 40; index += 1) {
        const result = await client.query(`select public.validate_promo('INCONNU', '2026-10-06', 5500) as quote`);
        last = result.rows[0].quote;
      }
    });
    const count = await pool.query(`select count(*)::int as n from public.promo_attempts where user_id = $1`, [clientId]);
    expect(count.rows[0].n).toBe(40);
    expect(last.ok).toBe(false);
    expect(last.error).toMatch(/Trop de tentatives/);
  });

  it('retient les frais d’une annulation tardive sur place', async () => {
    const bookingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
    await pool.query(`delete from public.bookings where id = $1`, [bookingId]);
    await insertBooking(pool, { id: bookingId, clientId, method: 'sur_place', status: 'confirme', pay: 'a_encaisser', intent: null, total: 4024, price: 3500, offsetHours: 5 });
    await withRole(pool, 'authenticated', { sub: clientId }, (client) => client.query(`select public.cancel_booking($1::uuid)`, [bookingId]));
    const row = await pool.query(`select fee_owing_cents from public.bookings where id = $1`, [bookingId]);
    expect(row.rows[0].fee_owing_cents).toBe(1750);
  });

  it('vérifie le propriétaire avant d’abandonner un paiement', async () => {
    const bookingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
    await pool.query(`delete from public.bookings where id = $1`, [bookingId]);
    await insertBooking(pool, {
      id: bookingId,
      clientId,
      method: 'en_ligne',
      status: 'en_attente_paiement',
      pay: 'en_attente',
      intent: 'pi_pending',
      total: 4024,
      price: 3500,
      offsetHours: 7,
    });
    await expect(
      withRole(pool, 'service_role', {}, (client) =>
        client.query(`select public.service_begin_abandon($1::uuid, $2::uuid)`, [bookingId, ownerId]),
      ),
    ).rejects.toThrow(/introuvable/);
    const own = await withRole(pool, 'service_role', {}, (client) =>
      client.query(`select public.service_begin_abandon($1::uuid, $2::uuid) as intent`, [bookingId, clientId]),
    );
    expect(own.rows[0].intent).toBe('pi_pending');
    await pool.query(`update public.bookings set status = 'confirme' where id = $1`, [bookingId]);
    await pool.query(`update public.payments set status = 'paye' where booking_id = $1`, [bookingId]);
    await expect(
      withRole(pool, 'service_role', {}, (client) =>
        client.query(`select public.service_begin_abandon($1::uuid, $2::uuid)`, [bookingId, clientId]),
      ),
    ).rejects.toThrow(/introuvable/);
  });

  it('laisse postgres purger les notes et n’annonce pas un panier expiré', async () => {
    await pool.query('select public.purge_client_notes()');
    const bookingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
    await pool.query(`delete from public.bookings where id = $1`, [bookingId]);
    await insertBooking(pool, {
      id: bookingId,
      clientId,
      method: 'en_ligne',
      status: 'en_attente_paiement',
      pay: 'en_attente',
      intent: null,
      total: 4024,
      price: 3500,
      createdAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      offsetHours: 9,
    });
    await pool.query(
      `insert into public.notification_prefs (user_id, enabled) values ($1, true) on conflict (user_id) do update set enabled = true`,
      [clientId],
    );
    await withRole(pool, 'service_role', {}, (db) => db.query(`select public.expire_stale_checkouts()`));
    const notes = await pool.query(
      `select count(*)::int as n from public.notification_jobs where booking_id = $1 and kind = 'annulation'`,
      [bookingId],
    );
    expect(notes.rows[0].n).toBe(0);
  });
});

async function insertUser(pool: pg.Pool, id: string, email: string, name: string, role: string, barber: string | null) {
  await pool.query(
    `insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2, 'x', now(),
      '{}'::jsonb, jsonb_build_object('full_name', $3::text), now(), now(), '', '', '', ''
    )`,
    [id, email, name],
  );
  await pool.query(`update public.profiles set role = $2::public.user_role, full_name = $3, barber_id = $4, active = true where id = $1`, [
    id,
    role,
    name,
    barber,
  ]);
}

async function insertBooking(
  pool: pg.Pool,
  input: {
    id: string;
    clientId: string;
    method: 'en_ligne' | 'sur_place';
    status: string;
    pay: string;
    intent: string | null;
    total: number;
    price: number;
    createdAt?: string;
    offsetHours: number;
  },
) {
  await pool.query(
    `insert into public.bookings (
      id, client_id, client_name, barber_id, service_id, starts_at, ends_at, duration_minutes,
      price_cents, gst_cents, qst_cents, total_cents, payment_method, status, created_at
    ) values (
      $1, $2, 'Alex Gagnon', $3, $4, now() + make_interval(hours => $10), now() + make_interval(hours => $10, mins => 30), 30,
      $5, 175, 349, $6, $7::public.payment_method, $8::public.booking_status, coalesce($9::timestamptz, now())
    )`,
    [input.id, input.clientId, barberId, serviceId, input.price, input.total, input.method, input.status, input.createdAt ?? null, input.offsetHours],
  );
  await pool.query(
    `insert into public.payments (booking_id, method, status, amount_cents, stripe_payment_intent_id)
     values ($1, $2::public.payment_method, $3::public.payment_status, $4, $5)`,
    [input.id, input.method, input.pay, input.total, input.intent],
  );
}

async function withRole<T>(
  pool: pg.Pool,
  role: 'anon' | 'authenticated' | 'service_role',
  claims: Claims,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  const jwtRole = role;
  try {
    await client.query('begin');
    await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [claims.sub ?? '']);
    await client.query(`select set_config('request.jwt.claim.role', $1, true)`, [jwtRole]);
    await client.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ aal: claims.aal ?? 'aal1', role: jwtRole, sub: claims.sub ?? '' }),
    ]);
    await client.query(`set local role ${role}`);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
