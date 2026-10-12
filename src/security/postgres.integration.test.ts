import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { resolveTestDatabase } from './databaseGuard';

const databaseUrl = resolveTestDatabase() ?? undefined;
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

  it('plafonne les demandes de suppression anonymes et prévient le propriétaire', async () => {
    await withRole(pool, 'anon', {}, async (client) => {
      for (let index = 0; index < 4; index += 1) {
        await client.query(`select public.request_account_deletion($1)`, ['alex.gagnon@exemple.ca']);
      }
      for (let index = 0; index < 25; index += 1) {
        await client.query(`select public.request_account_deletion($1)`, [`visiteur${index}@exemple.ca`]);
      }
    });
    const requests = await pool.query(`select count(*)::int as n from public.deletion_requests`);
    expect(requests.rows[0].n).toBe(20);
    const same = await pool.query(`select count(*)::int as n from public.deletion_requests where email = 'alex.gagnon@exemple.ca'`);
    expect(same.rows[0].n).toBe(3);
    const notices = await pool.query(
      `select count(*)::int as n from public.notification_jobs where kind = 'suppression_compte' and user_id = $1`,
      [ownerId],
    );
    expect(notices.rows[0].n).toBe(20);
  });

  it('pose un bail sur la file de remboursement et rejoue un panier expiré', async () => {
    await pool.query(`delete from public.refund_jobs`);
    await pool.query(`delete from public.stripe_intent_jobs`);
    const bookingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5';
    await pool.query(`delete from public.bookings where id = $1`, [bookingId]);
    await insertBooking(pool, {
      id: bookingId,
      clientId,
      method: 'en_ligne',
      status: 'confirme',
      pay: 'remboursement_en_cours',
      intent: 'pi_lease',
      total: 6324,
      price: 5500,
      offsetHours: 11,
    });
    await pool.query(
      `insert into public.refund_jobs (booking_id, amount_cents, idempotency_key, kind)
       values ($1::uuid, 3574, $2, 'cancel')`,
      [bookingId, `refund-${bookingId}-cancel`],
    );
    const first = await withRole(pool, 'service_role', {}, (client) => client.query(`select public.claim_refund_jobs() as jobs`));
    const second = await withRole(pool, 'service_role', {}, (client) => client.query(`select public.claim_refund_jobs() as jobs`));
    expect(first.rows[0].jobs).toHaveLength(1);
    expect(first.rows[0].jobs[0].amount).toBe(3574);
    expect(second.rows[0].jobs).toHaveLength(0);

    const staleId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6';
    await pool.query(`delete from public.bookings where id = $1`, [staleId]);
    await insertBooking(pool, {
      id: staleId,
      clientId,
      method: 'en_ligne',
      status: 'en_attente_paiement',
      pay: 'en_attente',
      intent: 'pi_expire',
      total: 4024,
      price: 3500,
      createdAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      offsetHours: 13,
    });
    await withRole(pool, 'service_role', {}, (client) => client.query(`select public.expire_stale_checkouts()`));
    const queued = await pool.query(`select status from public.stripe_intent_jobs where booking_id = $1`, [staleId]);
    expect(queued.rows[0].status).toBe('en_attente');
    const claimed = await withRole(pool, 'service_role', {}, (client) => client.query(`select public.claim_intent_jobs() as jobs`));
    const again = await withRole(pool, 'service_role', {}, (client) => client.query(`select public.claim_intent_jobs() as jobs`));
    expect(claimed.rows[0].jobs).toHaveLength(1);
    expect(again.rows[0].jobs).toHaveLength(0);
    await withRole(pool, 'service_role', {}, (client) =>
      client.query(`select public.mark_intent_job($1::uuid, 'pi_expire', false, 'stripe down')`, [staleId]),
    );
    const replay = await withRole(pool, 'service_role', {}, (client) => client.query(`select public.claim_intent_jobs() as jobs`));
    expect(replay.rows[0].jobs).toHaveLength(1);
  });

  it('signale un remboursement en échec et exige aal2 pour le tableau de bord', async () => {
    const bookingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7';
    await pool.query(`delete from public.bookings where id = $1`, [bookingId]);
    await insertBooking(pool, {
      id: bookingId,
      clientId,
      method: 'en_ligne',
      status: 'annule',
      pay: 'remboursement_en_cours',
      intent: 'pi_alert',
      total: 6324,
      price: 5500,
      offsetHours: 15,
    });
    await pool.query(
      `insert into public.refund_jobs (booking_id, amount_cents, idempotency_key, kind, status, attempts, last_error)
       values ($1::uuid, 1000, $2, 'cancel', 'echec', 8, 'bloqué')`,
      [bookingId, `refund-${bookingId}-cancel`],
    );
    await pool.query(`select public.alert_stale_refunds()`);
    const audit = await pool.query(`select count(*)::int as n from public.audit_log where action = 'remboursement_echec'`);
    const push = await pool.query(
      `select count(*)::int as n from public.notification_jobs where kind = 'remboursement_bloque' and user_id = $1`,
      [ownerId],
    );
    expect(audit.rows[0].n).toBeGreaterThan(0);
    expect(push.rows[0].n).toBe(1);
    await expect(
      withRole(pool, 'authenticated', { sub: ownerId, aal: 'aal1' }, (client) =>
        client.query(`select public.admin_dashboard(current_date, 'jour')`),
      ),
    ).rejects.toThrow(/Vérification renforcée requise/);
    await expect(
      withRole(pool, 'authenticated', { sub: ownerId, aal: 'aal1' }, (client) => client.query(`select public.admin_clients()`)),
    ).rejects.toThrow(/Vérification renforcée requise/);
    for (const sql of [
      `select public.admin_move('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7'::uuid, current_date, 600)`,
      `select public.admin_block('20000000-0000-4000-8000-000000000002'::uuid, current_date, 600, 60, 'pause')`,
      `select public.admin_barber_setup()`,
      `select public.admin_moderate_review('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7'::uuid, 'masque')`,
    ]) {
      await expect(
        withRole(pool, 'authenticated', { sub: ownerId, aal: 'aal1' }, (client) => client.query(sql)),
      ).rejects.toThrow(/Vérification renforcée requise/);
    }
    const dashboard = await withRole(pool, 'authenticated', { sub: ownerId, aal: 'aal2' }, (client) =>
      client.query(`select public.admin_dashboard(current_date, 'jour') as data`),
    );
    expect(dashboard.rows[0].data).toBeTruthy();
  });

  it('ferme les nouvelles tables à anon et garde le RLS sur les tables existantes', async () => {
    await pool.query(`drop table if exists public.privilege_probe`);
    const open = await pool.query(
      `select c.relname
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`,
    );
    expect(open.rows).toEqual([]);
    await pool.query(`create table public.privilege_probe (id int)`);
    const priv = await pool.query(`select has_table_privilege('anon', 'public.privilege_probe', 'SELECT') as ok`);
    expect(priv.rows[0].ok).toBe(false);
    await pool.query(`drop table public.privilege_probe`);
    const salon = await pool.query(`select public.salon_public() as data`);
    expect(salon.rows[0].data[0].taxNumbersPlaceholder).toBe(true);
  });

  it('répond en_cours pendant le bail et traite seulement après succès', async () => {
    const first = await withRole(pool, 'service_role', {}, (client) =>
      client.query(`select public.claim_stripe_event('evt_busy') as claim`),
    );
    const second = await withRole(pool, 'service_role', {}, (client) =>
      client.query(`select public.claim_stripe_event('evt_busy') as claim`),
    );
    expect(first.rows[0].claim).toBe('acquis');
    expect(second.rows[0].claim).toBe('en_cours');
    await withRole(pool, 'service_role', {}, (client) => client.query(`select public.finish_stripe_event('evt_busy', true)`));
    const third = await withRole(pool, 'service_role', {}, (client) =>
      client.query(`select public.claim_stripe_event('evt_busy') as claim`),
    );
    expect(third.rows[0].claim).toBe('traite');
  });

  it('admin_move refuse un jour fermé et une heure hors grille sans rien écrire', async () => {
    const id = '55555555-5555-4555-8555-555555555555';
    await pool.query(`insert into public.barber_services (barber_id, service_id) values ($1, $2) on conflict do nothing`, [barberId, serviceId]);
    for (const weekday of [2, 3, 4, 5, 6]) {
      await pool.query(
        `insert into public.schedules (barber_id, weekday, start_minute, end_minute)
         values ($1, $2, 540, 1140)
         on conflict (barber_id, weekday) do nothing`,
        [barberId, weekday],
      );
    }
    await insertBooking(pool, {
      id,
      clientId,
      method: 'sur_place',
      status: 'confirme',
      pay: 'a_encaisser',
      intent: null,
      total: 4024,
      price: 3500,
      offsetHours: 72,
    });
    const before = await pool.query<{ starts_at: Date }>(`select starts_at from public.bookings where id = $1`, [id]);
    // Le lundi est ouvert par défaut : le propriétaire le ferme d’abord dans les horaires du salon.
    await pool.query(`update public.salon_hours set is_open = false where weekday = 1`);
    await expect(
      withRole(pool, 'authenticated', { sub: ownerId, aal: 'aal2' }, (client) =>
        client.query(`select public.admin_move($1::uuid, $2::date, 540)`, [id, upcoming(1)]),
      ),
    ).rejects.toThrow(/fermé/);
    await expect(
      withRole(pool, 'authenticated', { sub: ownerId, aal: 'aal2' }, (client) =>
        client.query(`select public.admin_move($1::uuid, $2::date, 7)`, [id, upcoming(3)]),
      ),
    ).rejects.toThrow(/invalide|heures/);
    const after = await pool.query<{ starts_at: Date }>(`select starts_at from public.bookings where id = $1`, [id]);
    expect(after.rows[0].starts_at.toISOString()).toBe(before.rows[0].starts_at.toISOString());
    await pool.query(`update public.salon_hours set is_open = true, open_minute = 0, close_minute = 1440 where weekday = 1`);
  });

  it('refuse un prix nul et un pourcentage hors limites, et garde le compteur promo', async () => {
    await expect(
      withRole(pool, 'authenticated', { sub: ownerId, aal: 'aal2' }, (client) =>
        client.query(`select public.admin_update_service($1::uuid, 0)`, [serviceId]),
      ),
    ).rejects.toThrow(/Tarif invalide/);
    const price = await pool.query<{ price_cents: number }>(`select price_cents from public.services where id = $1`, [serviceId]);
    expect(price.rows[0].price_cents).toBe(3500);
    await pool.query(
      `insert into public.promo_codes (code, discount_type, value, starts_on, ends_on, usage_limit, usage_count)
       values ('ETE20', 'percent', 20, '2026-07-01', '2026-08-31', 30, 30)
       on conflict (code) do update set usage_count = 30, usage_limit = 30`,
    );
    await expect(
      withRole(pool, 'authenticated', { sub: ownerId, aal: 'aal2' }, (client) =>
        client.query(`select public.admin_save_promo($1::jsonb)`, [
          JSON.stringify({
            code: 'ETE20',
            discountType: 'percent',
            value: 150,
            startsOn: '2026-07-01',
            endsOn: '2026-12-31',
            usageLimit: null,
            usageCount: 0,
            active: true,
          }),
        ]),
      ),
    ).rejects.toThrow(/100/);
    const kept = await pool.query<{ usage_count: number; value: string }>(`select usage_count, value from public.promo_codes where code = 'ETE20'`);
    expect(kept.rows[0].usage_count).toBe(30);
    expect(Number(kept.rows[0].value)).toBe(20);
  });

  it('insère une réservation sur place, en ligne et avec promo, et refuse congé ou coiffeur inactif', async () => {
    await pool.query(`delete from public.booking_attempts where user_id = $1`, [clientId]);
    await pool.query(`delete from public.promo_attempts where user_id = $1`, [clientId]);
    await pool.query(`delete from public.refund_jobs where booking_id in (select id from public.bookings where client_id = $1)`, [clientId]);
    await pool.query(`delete from public.stripe_intent_jobs where booking_id in (select id from public.bookings where client_id = $1)`, [clientId]);
    await pool.query(`delete from public.promo_redemptions where client_id = $1`, [clientId]);
    await pool.query(`delete from public.payments where booking_id in (select id from public.bookings where client_id = $1)`, [clientId]);
    await pool.query(`delete from public.bookings where client_id = $1`, [clientId]);
    await pool.query(`insert into public.barber_services (barber_id, service_id) values ($1, $2) on conflict do nothing`, [barberId, serviceId]);
    for (const weekday of [2, 3, 4, 5, 6]) {
      await pool.query(
        `insert into public.schedules (barber_id, weekday, start_minute, end_minute)
         values ($1, $2, 540, 1140)
         on conflict (barber_id, weekday) do nothing`,
        [barberId, weekday],
      );
    }
    const book = (date: string, method: 'sur_place' | 'en_ligne', promo: string | null) =>
      withRole(pool, 'authenticated', { sub: clientId, aal: 'aal1' }, (client) =>
        client.query<{ data: { ok: boolean; id?: string; totalCents?: number; error?: string } }>(
          `select public.create_booking($1::uuid, $2::uuid, $3::date, 660, $4::public.payment_method, false, $5) as data`,
          [serviceId, barberId, date, method, promo],
        ),
      );

    // Dates relatives au jour réel : create_booking refuse un créneau passé selon now() côté Postgres.
    const friday = upcoming(5);
    const wednesday = upcoming(3);
    const promoFrom = addDays(torontoToday(), -1);
    const promoTo = addDays(torontoToday(), 90);
    const onsite = await book(friday, 'sur_place', null);
    expect(onsite.rows[0].data.ok).toBe(true);
    expect(onsite.rows[0].data.totalCents).toBe(4024);
    const onsiteRow = await pool.query<{ status: string; pay: string }>(
      `select b.status::text as status, p.status::text as pay
       from public.bookings b join public.payments p on p.booking_id = b.id where b.id = $1`,
      [onsite.rows[0].data.id],
    );
    expect(onsiteRow.rows[0]).toEqual({ status: 'confirme', pay: 'a_encaisser' });

    const online = await book(wednesday, 'en_ligne', null);
    expect(online.rows[0].data.ok).toBe(true);
    expect(online.rows[0].data.totalCents).toBe(4024);
    const onlineRow = await pool.query<{ status: string; pay: string }>(
      `select b.status::text as status, p.status::text as pay
       from public.bookings b join public.payments p on p.booking_id = b.id where b.id = $1`,
      [online.rows[0].data.id],
    );
    expect(onlineRow.rows[0]).toEqual({ status: 'en_attente_paiement', pay: 'en_attente' });

    await pool.query(
      `insert into public.promo_codes (code, discount_type, value, starts_on, ends_on, usage_limit, usage_count)
       values ('MARDI15', 'percent', 15, $1, $2, 40, 0)
       on conflict (code) do update set value = 15, usage_count = 0, usage_limit = 40, active = true, starts_on = $1, ends_on = $2`,
      [promoFrom, promoTo],
    );
    const reduced = await book(addDays(friday, 7), 'sur_place', 'mardi15');
    expect(reduced.rows[0].data).toMatchObject({ ok: true, totalCents: 3421 });
    const promoUse = await pool.query<{ usage_count: number; discount_cents: number }>(
      `select c.usage_count, b.discount_cents
       from public.promo_codes c
       join public.bookings b on b.promo_code = c.code
       where c.code = 'MARDI15' and b.id = $1`,
      [reduced.rows[0].data.id],
    );
    expect(promoUse.rows[0].usage_count).toBe(1);
    expect(promoUse.rows[0].discount_cents).toBe(525);

    await pool.query(`delete from public.refund_jobs where booking_id in (select id from public.bookings where client_id = $1)`, [clientId]);
    await pool.query(`delete from public.stripe_intent_jobs where booking_id in (select id from public.bookings where client_id = $1)`, [clientId]);
    await pool.query(`delete from public.promo_redemptions where client_id = $1`, [clientId]);
    await pool.query(`delete from public.payments where booking_id in (select id from public.bookings where client_id = $1)`, [clientId]);
    await pool.query(`delete from public.bookings where client_id = $1`, [clientId]);

    await pool.query(`delete from public.schedules where barber_id = $1 and weekday = 5`, [barberId]);
    const closed = await book(addDays(friday, 14), 'sur_place', null);
    expect(closed.rows[0].data.ok).toBe(false);
    expect(closed.rows[0].data.error).toMatch(/ne travaille pas/);
    await pool.query(
      `insert into public.schedules (barber_id, weekday, start_minute, end_minute) values ($1, 5, 540, 1140)`,
      [barberId],
    );

    await pool.query(`update public.barbers set active = false where id = $1`, [barberId]);
    const inactive = await book(addDays(wednesday, 7), 'sur_place', null);
    expect(inactive.rows[0].data.ok).toBe(false);
    expect(inactive.rows[0].data.error).toMatch(/inactif/);
    await pool.query(`update public.barbers set active = true where id = $1`, [barberId]);

    await pool.query(
      `insert into public.promo_codes (code, discount_type, value, starts_on, ends_on, usage_limit, usage_count, active)
       values ('LIBRE100', 'percent', 100, $1, $2, 5, 0, true)
       on conflict (code) do update set value = 100, usage_count = 0, active = true, starts_on = $1, ends_on = $2`,
      [promoFrom, promoTo],
    );
    const free = await book(addDays(wednesday, 14), 'en_ligne', 'LIBRE100');
    expect(free.rows[0].data).toMatchObject({ ok: true, totalCents: 0 });
    const freeRow = await pool.query<{ status: string; pay: string; amount: number }>(
      `select b.status::text as status, p.status::text as pay, p.amount_cents as amount
       from public.bookings b join public.payments p on p.booking_id = b.id where b.id = $1`,
      [free.rows[0].data.id],
    );
    expect(freeRow.rows[0]).toEqual({ status: 'confirme', pay: 'a_encaisser', amount: 0 });
    const consumed = await pool.query<{ usage_count: number }>(`select usage_count from public.promo_codes where code = 'LIBRE100'`);
    expect(consumed.rows[0].usage_count).toBe(1);

    await expect(
      withRole(pool, 'authenticated', { sub: ownerId, aal: 'aal2' }, (client) =>
        client.query(`select public.admin_update_salon(-600, 5000, 'aucun', true)`),
      ),
    ).rejects.toThrow(/Réglage invalide/);

    await pool.query(`delete from public.refund_jobs where booking_id in (select id from public.bookings where starts_at > now())`);
    await pool.query(`delete from public.stripe_intent_jobs where booking_id in (select id from public.bookings where starts_at > now())`);
    await pool.query(`delete from public.promo_redemptions where booking_id in (select id from public.bookings where starts_at > now())`);
    await pool.query(`delete from public.payments where booking_id in (select id from public.bookings where starts_at > now())`);
    await pool.query(`delete from public.bookings where starts_at > now()`);
    const pastId = '66666666-6666-4666-8666-666666666666';
    await pool.query(
      `insert into public.bookings (
         id, client_id, client_name, barber_id, service_id, starts_at, ends_at, duration_minutes,
         price_cents, gst_cents, qst_cents, total_cents, payment_method, status
       ) values (
         $1, $2, 'Loïc Bergeron', $3, $4, '2026-09-01 12:00:00+00', '2026-09-01 12:30:00+00', 30,
         3500, 175, 349, 4024, 'sur_place'::public.payment_method, 'honore'::public.booking_status
       )`,
      [pastId, clientId, barberId, serviceId],
    );
    await withRole(pool, 'authenticated', { sub: ownerId, aal: 'aal2' }, (client) =>
      client.query(`select public.admin_update_salon(600, 1020, 'aucun', false)`),
    );
    const futureId = '77777777-7777-4777-8777-777777777777';
    await pool.query(
      `insert into public.bookings (
         id, client_id, client_name, barber_id, service_id, starts_at, ends_at, duration_minutes,
         price_cents, gst_cents, qst_cents, total_cents, payment_method, status
       ) values (
         $1, $2, 'Loïc Bergeron', $3, $4, ($5::date + time '12:00') at time zone 'UTC', ($5::date + time '12:30') at time zone 'UTC', 30,
         3500, 175, 349, 4024, 'sur_place'::public.payment_method, 'confirme'::public.booking_status
       )`,
      [futureId, clientId, barberId, serviceId, upcoming(2)],
    );
    await expect(
      withRole(pool, 'authenticated', { sub: ownerId, aal: 'aal2' }, (client) =>
        client.query(`select public.admin_update_salon(600, 1020, 'aucun', false)`),
      ),
    ).rejects.toThrow(/sortent/);
    try {
      await withRole(pool, 'authenticated', { sub: ownerId, aal: 'aal2' }, (client) =>
        client.query(`select public.admin_update_salon(600, 1020, 'aucun', false)`),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      expect(message).not.toMatch(/Loïc|Bergeron/);
      expect(message).toContain(futureId);
    }
    await withRole(pool, 'authenticated', { sub: ownerId, aal: 'aal2' }, (client) =>
      client.query(`select public.admin_update_salon(540, 1140, 'a_la_prochaine', true)`),
    );

    const path = await pool.query<{ proconfig: string[] | null }>(
      `select proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'create_booking'`,
    );
    expect(path.rows[0].proconfig?.join(' ')).toMatch(/search_path=""/);
  });

  it('ajoute, retire et réactive une chaise sans perdre l’historique', async () => {
    const coiffeurId = '55555555-5555-4555-8555-555555555555';
    const owner = <T,>(sql: string, params: unknown[] = []) =>
      withRole(pool, 'authenticated', { sub: ownerId, aal: 'aal2' }, (client) => client.query<T & pg.QueryResultRow>(sql, params));
    const asClient = <T,>(sql: string, params: unknown[] = []) =>
      withRole(pool, 'authenticated', { sub: clientId, aal: 'aal1' }, (client) => client.query<T & pg.QueryResultRow>(sql, params));
    const book = (barber: string, service: string, date: string) =>
      asClient<{ data: { ok: boolean; id?: string; error?: string } }>(
        `select public.create_booking($1::uuid, $2::uuid, $3::date, 600, 'sur_place'::public.payment_method, false, null) as data`,
        [service, barber, date],
      );
    await pool.query(`delete from public.booking_attempts where user_id = $1`, [clientId]);

    for (const name of ['admin_barbers()', 'admin_create_barber(text, text, text, integer[], uuid[])', 'admin_archive_barber(uuid)', 'admin_reactivate_barber(uuid)', 'catalogue_slug(text, text)', 'assert_owner(text)']) {
      const allowed = await pool.query(`select has_function_privilege('anon', $1, 'execute') as ok`, [`public.${name}`]);
      expect(allowed.rows[0].ok).toBe(false);
    }
    const create = `select public.admin_create_barber('Noah Pelletier', 'Noah', '', array[2,3,4,5,6], array[$1::uuid]) as id`;
    await expect(asClient(create, [serviceId])).rejects.toThrow(/Accès refusé/);
    await expect(
      withRole(pool, 'authenticated', { sub: ownerId, aal: 'aal1' }, (client) => client.query(create, [serviceId])),
    ).rejects.toThrow(/Vérification renforcée requise/);
    await expect(owner(`select public.admin_create_barber('Noah Pelletier', 'Noah', '', array[7], array[$1::uuid])`, [serviceId])).rejects.toThrow(
      /jour de la semaine|au moins un jour/,
    );
    await expect(owner(`select public.admin_create_barber('Noah Pelletier', 'Noah', '', array[2], array[]::uuid[])`)).rejects.toThrow(
      /au moins une prestation/,
    );
    const created = await owner<{ id: string }>(create, [serviceId]);
    const noah = created.rows[0].id;
    const row = await pool.query(`select slug, photo_path, active from public.barbers where id = $1`, [noah]);
    expect(row.rows[0]).toEqual({ slug: 'noah-pelletier', photo_path: '', active: true });
    const publicList = await withRole(pool, 'anon', {}, (client) => client.query<{ data: { id: string }[] }>(`select public.visible_barbers() as data`));
    expect(publicList.rows[0].data.map((item) => item.id)).toContain(noah);
    const wednesday = upcoming(3);
    const slots = await withRole(pool, 'anon', {}, (client) =>
      client.query<{ data: { available: boolean; barberId: string | null }[] }>(`select public.list_slots($1::uuid, $2::date, $3::uuid) as data`, [serviceId, wednesday, noah]),
    );
    expect(slots.rows[0].data.some((slot) => slot.available && slot.barberId === noah)).toBe(true);

    await insertUser(pool, coiffeurId, 'noah@lenanometre.ca', 'Noah Pelletier', 'coiffeur', noah);
    await expect(
      withRole(pool, 'authenticated', { sub: coiffeurId, aal: 'aal2' }, (client) => client.query(`select public.admin_archive_barber($1::uuid)`, [noah])),
    ).rejects.toThrow(/Accès refusé/);

    const booked = await book(noah, serviceId, wednesday);
    expect(booked.rows[0].data.ok).toBe(true);
    await expect(owner(`select public.admin_archive_barber($1::uuid)`, [noah])).rejects.toThrow(/Noah Pelletier a encore 1 rendez-vous à venir/);
    const stillActive = await pool.query(`select active from public.barbers where id = $1`, [noah]);
    expect(stillActive.rows[0].active).toBe(true);
    await pool.query(`update public.bookings set status = 'annule', cancelled_at = now() where id = $1`, [booked.rows[0].data.id]);

    const archived = await owner<{ data: { deactivatedAccounts: number } }>(`select public.admin_archive_barber($1::uuid) as data`, [noah]);
    expect(archived.rows[0].data.deactivatedAccounts).toBe(1);
    const account = await pool.query(`select active, invited_at from public.profiles where id = $1`, [coiffeurId]);
    expect(account.rows[0]).toEqual({ active: false, invited_at: null });
    const hidden = await withRole(pool, 'anon', {}, (client) => client.query<{ data: { id: string }[] }>(`select public.visible_barbers() as data`));
    expect(hidden.rows[0].data.map((item) => item.id)).not.toContain(noah);
    const noSlots = await withRole(pool, 'anon', {}, (client) =>
      client.query<{ data: { available: boolean }[] }>(`select public.list_slots($1::uuid, $2::date, $3::uuid) as data`, [serviceId, addDays(wednesday, 7), noah]),
    );
    expect(noSlots.rows[0].data.some((slot) => slot.available)).toBe(false);
    const refused = await book(noah, serviceId, addDays(wednesday, 7));
    expect(refused.rows[0].data).toMatchObject({ ok: false, error: 'Ce coiffeur est inactif.' });
    const history = await asClient<{ data: ({ id: string; barberName: string } | null)[] }>(`select public.my_bookings() as data`);
    expect(history.rows[0].data.find((item) => item?.id === booked.rows[0].data.id)?.barberName).toBe('Noah Pelletier');
    const managed = await owner<{ data: { id: string; active: boolean }[] }>(`select public.admin_barbers() as data`);
    expect(managed.rows[0].data.find((item) => item.id === noah)?.active).toBe(false);
    const logged = await pool.query(`select count(*)::int as n from public.audit_log where action = 'coiffeur_retrait' and entity_id = $1`, [noah]);
    expect(logged.rows[0].n).toBe(1);
    await expect(owner(`select public.admin_set_active($1::uuid, true)`, [coiffeurId])).rejects.toThrow(/chaise de ce coiffeur est retirée/);

    await owner(`select public.admin_reactivate_barber($1::uuid)`, [noah]);
    await expect(owner(`select public.admin_reactivate_barber($1::uuid)`, [noah])).rejects.toThrow(/déjà actif/);
    await owner(`select public.admin_set_active($1::uuid, true)`, [coiffeurId]);

    // Dernière chaise active : refus. Chaise liée au propriétaire : il reste propriétaire actif.
    await pool.query(`update public.profiles set active = false where id = $1`, [coiffeurId]);
    await owner(`select public.admin_archive_barber($1::uuid)`, [noah]);
    await expect(owner(`select public.admin_archive_barber($1::uuid)`, [barberId])).rejects.toThrow(/au moins un coiffeur actif/);
    await owner(`select public.admin_reactivate_barber($1::uuid)`, [noah]);
    await pool.query(`update public.bookings set status = 'annule' where barber_id = $1 and ends_at > now() and status in ('confirme', 'en_attente_paiement')`, [barberId]);
    await owner(`select public.admin_archive_barber($1::uuid)`, [barberId]);
    const ownerRow = await pool.query(`select role::text as role, active from public.profiles where id = $1`, [ownerId]);
    expect(ownerRow.rows[0]).toEqual({ role: 'proprietaire', active: true });
    await owner(`select public.admin_reactivate_barber($1::uuid)`, [barberId]);

    const config = await pool.query<{ proname: string; cfg: string }>(
      `select p.proname, array_to_string(p.proconfig, ' ') as cfg from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('admin_barbers', 'admin_create_barber', 'admin_archive_barber', 'admin_reactivate_barber',
         'admin_services', 'admin_create_service', 'admin_archive_service', 'admin_reactivate_service', 'admin_set_service', 'admin_set_active',
         'admin_move', 'list_slots', 'assert_owner', 'catalogue_slug')`,
    );
    expect(config.rows).toHaveLength(14);
    for (const fn of config.rows) {
      expect(fn.cfg, fn.proname).toMatch(/search_path=""/);
    }
  });

  it('ajoute, retire et réactive une prestation sans toucher aux reçus', async () => {
    const owner = <T,>(sql: string, params: unknown[] = []) =>
      withRole(pool, 'authenticated', { sub: ownerId, aal: 'aal2' }, (client) => client.query<T & pg.QueryResultRow>(sql, params));
    const asClient = <T,>(sql: string, params: unknown[] = []) =>
      withRole(pool, 'authenticated', { sub: clientId, aal: 'aal1' }, (client) => client.query<T & pg.QueryResultRow>(sql, params));
    await pool.query(`delete from public.booking_attempts where user_id = $1`, [clientId]);
    const noah = (await pool.query<{ id: string }>(`select id from public.barbers where slug = 'noah-pelletier'`)).rows[0].id;

    const createService = `select public.admin_create_service($1, $2, $3, $4, $5::uuid[]) as id`;
    await expect(asClient(createService, ['Coupe longue', '', 45, 4200, [noah]])).rejects.toThrow(/Accès refusé/);
    await expect(
      withRole(pool, 'authenticated', { sub: ownerId, aal: 'aal1' }, (client) => client.query(createService, ['Coupe longue', '', 45, 4200, [noah]])),
    ).rejects.toThrow(/Vérification renforcée requise/);
    await expect(owner(createService, ['coupe classique', '', 30, 3500, [noah]])).rejects.toThrow(/déjà ce nom/);
    await expect(owner(createService, ['Coupe longue', '', 7, 4200, [noah]])).rejects.toThrow(/Durée invalide/);
    await expect(owner(createService, ['Coupe longue', '', 45, 0, [noah]])).rejects.toThrow(/Tarif invalide/);
    await expect(owner(createService, ['Coupe longue', '', 45, 4200, []])).rejects.toThrow(/au moins un coiffeur actif/);
    const longue = (await owner<{ id: string }>(createService, ['Coupe longue', 'Cheveux mi-longs', 45, 4200, [noah]])).rows[0].id;
    const offeredBy = await pool.query(`select barber_id from public.barber_services where service_id = $1`, [longue]);
    expect(offeredBy.rows.map((item) => item.barber_id)).toEqual([noah]);
    const catalogue = await withRole(pool, 'anon', {}, (client) => client.query<{ data: { id: string }[] }>(`select public.visible_services() as data`));
    expect(catalogue.rows[0].data.map((item) => item.id)).toContain(longue);

    // Noah ne garde que la nouvelle prestation : on ne peut ni la lui enlever, ni la retirer du catalogue.
    await owner(`select public.admin_set_service($1::uuid, $2::uuid, false)`, [noah, serviceId]);
    await expect(owner(`select public.admin_set_service($1::uuid, $2::uuid, false)`, [noah, longue])).rejects.toThrow(/garder au moins une prestation/);
    await expect(owner(`select public.admin_archive_service($1::uuid)`, [longue])).rejects.toThrow(/seule prestation de : Noah/);
    await owner(`select public.admin_set_service($1::uuid, $2::uuid, true)`, [noah, serviceId]);

    const thursday = upcoming(4);
    const booked = await asClient<{ data: { ok: boolean; id: string } }>(
      `select public.create_booking($1::uuid, $2::uuid, $3::date, 660, 'sur_place'::public.payment_method, false, null) as data`,
      [longue, noah, thursday],
    );
    expect(booked.rows[0].data.ok).toBe(true);
    await expect(owner(`select public.admin_archive_service($1::uuid)`, [longue])).rejects.toThrow(/« Coupe longue » a encore 1 rendez-vous à venir/);
    await pool.query(`update public.bookings set status = 'annule', cancelled_at = now() where id = $1`, [booked.rows[0].data.id]);
    const pastId = '88888888-8888-4888-8888-888888888888';
    await pool.query(
      `insert into public.bookings (
         id, client_id, client_name, barber_id, service_id, starts_at, ends_at, duration_minutes,
         price_cents, gst_cents, qst_cents, total_cents, payment_method, status
       ) values (
         $1, $2, 'Alex Gagnon', $3, $4, '2026-09-02 14:00:00+00', '2026-09-02 14:45:00+00', 45,
         4200, 210, 419, 4829, 'sur_place'::public.payment_method, 'confirme'::public.booking_status
       )`,
      [pastId, clientId, noah, longue],
    );
    await pool.query(
      `insert into public.payments (booking_id, method, status, amount_cents) values ($1, 'sur_place'::public.payment_method, 'a_encaisser'::public.payment_status, 4829)`,
      [pastId],
    );
    await owner(`select public.admin_archive_service($1::uuid)`, [longue]);
    const gone = await withRole(pool, 'anon', {}, (client) => client.query<{ data: { id: string }[] }>(`select public.visible_services() as data`));
    expect(gone.rows[0].data.map((item) => item.id)).not.toContain(longue);
    await expect(
      withRole(pool, 'anon', {}, (client) => client.query(`select public.list_slots($1::uuid, $2::date, null)`, [longue, addDays(thursday, 7)])),
    ).rejects.toThrow(/Prestation introuvable/);
    const refused = await asClient<{ data: { ok: boolean; error: string } }>(
      `select public.create_booking($1::uuid, $2::uuid, $3::date, 660, 'sur_place'::public.payment_method, false, null) as data`,
      [longue, noah, addDays(thursday, 7)],
    );
    expect(refused.rows[0].data).toMatchObject({ ok: false, error: 'Prestation introuvable.' });
    const history = await asClient<{ data: ({ id: string; serviceName: string; priceCents: number; totalCents: number } | null)[] }>(
      `select public.my_bookings() as data`,
    );
    expect(history.rows[0].data.find((item) => item?.id === pastId)).toMatchObject({ serviceName: 'Coupe longue', priceCents: 4200, totalCents: 4829 });
    await expect(owner(`select public.admin_move($1::uuid, $2::date, 600)`, [pastId, addDays(thursday, 7)])).rejects.toThrow(/prestation est retirée/);
    const managed = await owner<{ data: { id: string; active: boolean }[] }>(`select public.admin_services() as data`);
    expect(managed.rows[0].data.find((item) => item.id === longue)?.active).toBe(false);
    await expect(owner(`select public.admin_set_service($1::uuid, $2::uuid, true)`, [barberId, longue])).rejects.toThrow(/retirée/);

    await owner(`select public.admin_reactivate_service($1::uuid)`, [longue]);
    await owner(`select public.admin_archive_service($1::uuid)`, [longue]);
    await expect(owner(`select public.admin_archive_service($1::uuid)`, [serviceId])).rejects.toThrow(/au moins une prestation/);
    const audit = await pool.query<{ action: string }>(
      `select action from public.audit_log where entity = 'service' and entity_id = $1 order by created_at`,
      [longue],
    );
    expect(audit.rows.map((item) => item.action)).toEqual(['prestation_ajout', 'prestation_retrait', 'prestation_reactivation', 'prestation_retrait']);
    await owner(`select public.admin_reactivate_service($1::uuid)`, [longue]);
  });

  it('durcit l’équipe et le catalogue : verrous, heures du salon, jours, réactivation et plafond d’invitations', async () => {
    const owner = <T,>(sql: string, params: unknown[] = []) =>
      withRole(pool, 'authenticated', { sub: ownerId, aal: 'aal2' }, (client) => client.query<T & pg.QueryResultRow>(sql, params));
    const asClient = <T,>(sql: string, params: unknown[] = []) =>
      withRole(pool, 'authenticated', { sub: clientId, aal: 'aal1' }, (client) => client.query<T & pg.QueryResultRow>(sql, params));
    const book = (barber: string, date: string, start: number) =>
      asClient<{ data: { ok: boolean; id?: string; error?: string } }>(
        `select public.create_booking($1::uuid, $2::uuid, $3::date, $4, 'sur_place'::public.payment_method, false, null) as data`,
        [serviceId, barber, date, start],
      );
    const freeClient = async () => {
      await pool.query(`delete from public.booking_attempts where user_id = $1`, [clientId]);
      await pool.query(
        `update public.bookings set status = 'annule', cancelled_at = now()
         where client_id = $1 and starts_at > now() and status in ('confirme', 'en_attente_paiement')`,
        [clientId],
      );
    };
    await freeClient();

    const ousmane = (
      await owner<{ id: string }>(`select public.admin_create_barber('Ousmane Diallo', 'Ousmane', '', array[2,3,4,5,6], array[$1::uuid]) as id`, [serviceId])
    ).rows[0].id;
    const rasage = (
      await owner<{ id: string }>(`select public.admin_create_service('Rasage test', '', 30, 2500, array[$1::uuid]) as id`, [ousmane])
    ).rows[0].id;

    // M-2 : list_slots suit salon_hours (jour par jour), comme create_booking.
    const week = (openMinute: number, closeMinute: number, open = true) =>
      JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((weekday) =>
        weekday === 3 ? { weekday, open, openMinute: open ? openMinute : null, closeMinute: open ? closeMinute : null } : { weekday, open: true, openMinute: 0, closeMinute: 1440 },
      ));
    await owner(`select public.admin_set_salon_hours($1::jsonb, true)`, [week(600, 960)]);
    const wednesday = addDays(upcoming(3), 7);
    const narrow = await withRole(pool, 'anon', {}, (client) =>
      client.query<{ data: { startMinute: number }[] }>(`select public.list_slots($1::uuid, $2::date, $3::uuid) as data`, [serviceId, wednesday, ousmane]),
    );
    const narrowStarts = narrow.rows[0].data.map((slot) => slot.startMinute);
    expect(narrowStarts[0]).toBe(600);
    expect(narrowStarts[narrowStarts.length - 1]).toBe(930);
    await owner(`select public.admin_set_salon_hours($1::jsonb, true)`, [week(480, 1200)]);
    const wide = await withRole(pool, 'anon', {}, (client) =>
      client.query<{ data: { startMinute: number; available: boolean }[] }>(`select public.list_slots($1::uuid, $2::date, $3::uuid) as data`, [serviceId, wednesday, ousmane]),
    );
    expect(wide.rows[0].data[0]).toMatchObject({ startMinute: 480, available: true });
    expect(wide.rows[0].data[wide.rows[0].data.length - 1].startMinute).toBe(1170);
    const early = await book(ousmane, wednesday, 480);
    expect(early.rows[0].data.ok).toBe(true);
    await pool.query(`update public.bookings set status = 'annule', cancelled_at = now() where id = $1`, [early.rows[0].data.id]);
    await owner(`select public.admin_set_salon_hours($1::jsonb, true)`, [week(0, 1440)]);
    await freeClient();

    // F-3 : jours bornés, dernier jour gardé, rendez-vous à venir protégés, messages en français.
    await owner(`select public.admin_set_weekday($1::uuid, 0, true)`, [ousmane]);
    await owner(`select public.admin_set_weekday($1::uuid, 0, false)`, [ousmane]);
    await expect(owner(`select public.admin_set_weekday($1::uuid, 99, true)`, [ousmane])).rejects.toThrow(/^Choisis un jour de la semaine/);
    await expect(
      withRole(pool, 'authenticated', { sub: ownerId, aal: 'aal1' }, (client) => client.query(`select public.admin_set_weekday($1::uuid, 3, false)`, [ousmane])),
    ).rejects.toThrow(/Vérification renforcée requise/);
    const thisWednesday = upcoming(3);
    const onWednesday = await book(ousmane, thisWednesday, 600);
    expect(onWednesday.rows[0].data.ok).toBe(true);
    await expect(owner(`select public.admin_set_weekday($1::uuid, 3, false)`, [ousmane])).rejects.toThrow(
      /Ousmane a encore 1 rendez-vous à venir le mercredi/,
    );
    await pool.query(`update public.bookings set status = 'annule', cancelled_at = now() where id = $1`, [onWednesday.rows[0].data.id]);
    for (const day of [3, 4, 5, 6]) {
      await owner(`select public.admin_set_weekday($1::uuid, $2, false)`, [ousmane, day]);
    }
    await expect(owner(`select public.admin_set_weekday($1::uuid, 2, false)`, [ousmane])).rejects.toThrow(/Ousmane doit garder au moins un jour de travail/);
    for (const day of [3, 4, 5, 6]) {
      await owner(`select public.admin_set_weekday($1::uuid, $2, true)`, [ousmane, day]);
    }
    const schedule = await pool.query<{ days: number[] }>(`select array_agg(weekday order by weekday) as days from public.schedules where barber_id = $1`, [ousmane]);
    expect(schedule.rows[0].days).toEqual([2, 3, 4, 5, 6]);
    const dayAudit = await pool.query(`select count(*)::int as n from public.audit_log where action = 'coiffeur_jour' and entity_id = $1`, [ousmane]);
    expect(dayAudit.rows[0].n).toBe(10);
    await freeClient();

    // F-4 : deux retraits simultanés ne laissent pas Ousmane sans prestation.
    const first = await openSession(pool, { sub: ownerId, aal: 'aal2' });
    const second = await openSession(pool, { sub: ownerId, aal: 'aal2' });
    try {
      await first.query(`select public.admin_set_service($1::uuid, $2::uuid, false)`, [ousmane, serviceId]);
      const racing = second.query(`select public.admin_set_service($1::uuid, $2::uuid, false)`, [ousmane, rasage]);
      const outcome = racing.then(
        () => 'ok',
        (error: Error) => error.message,
      );
      await sleep(300);
      await first.query('commit');
      expect(await outcome).toMatch(/garder au moins une prestation/);
      await second.query('rollback');
    } finally {
      first.release();
      second.release();
    }
    const left = await pool.query(`select count(*)::int as n from public.barber_services where barber_id = $1`, [ousmane]);
    expect(left.rows[0].n).toBe(1);
    await owner(`select public.admin_set_service($1::uuid, $2::uuid, true)`, [ousmane, serviceId]);

    // M-1 : un rendez-vous passé ramené dans le futur ne finit pas sur une chaise retirée.
    const pastId = '99999999-9999-4999-8999-999999999991';
    await pool.query(
      `insert into public.bookings (
         id, client_id, client_name, barber_id, service_id, starts_at, ends_at, duration_minutes,
         price_cents, gst_cents, qst_cents, total_cents, payment_method, status
       ) values (
         $1, $2, 'Alex Gagnon', $3, $4, '2026-09-02 14:00:00+00', '2026-09-02 14:30:00+00', 30,
         3500, 175, 349, 4024, 'sur_place'::public.payment_method, 'confirme'::public.booking_status
       )`,
      [pastId, clientId, ousmane, serviceId],
    );
    const target = addDays(upcoming(4), 7);
    // G : l’archivage tient la chaise, le déplacement attend puis est refusé.
    let archiving = await openSession(pool, { sub: ownerId, aal: 'aal2' });
    let moving = await openSession(pool, { sub: ownerId, aal: 'aal2' });
    try {
      await archiving.query(`select public.admin_archive_barber($1::uuid)`, [ousmane]);
      const outcome = moving.query(`select public.admin_move($1::uuid, $2::date, 600)`, [pastId, target]).then(
        () => 'ok',
        (error: Error) => error.message,
      );
      await sleep(300);
      await archiving.query('commit');
      expect(await outcome).toMatch(/Ce coiffeur est retiré/);
      await moving.query('rollback');
    } finally {
      archiving.release();
      moving.release();
    }
    const stayedPast = await pool.query(`select starts_at < now() as past from public.bookings where id = $1`, [pastId]);
    expect(stayedPast.rows[0].past).toBe(true);
    await owner(`select public.admin_reactivate_barber($1::uuid)`, [ousmane]);
    // H : le déplacement tient la chaise, l’archivage attend puis voit le rendez-vous à venir.
    archiving = await openSession(pool, { sub: ownerId, aal: 'aal2' });
    moving = await openSession(pool, { sub: ownerId, aal: 'aal2' });
    try {
      await moving.query(`select public.admin_move($1::uuid, $2::date, 600)`, [pastId, target]);
      const outcome = archiving.query(`select public.admin_archive_barber($1::uuid)`, [ousmane]).then(
        () => 'ok',
        (error: Error) => error.message,
      );
      await sleep(300);
      await moving.query('commit');
      expect(await outcome).toMatch(/Ousmane Diallo a encore 1 rendez-vous à venir/);
      await archiving.query('rollback');
    } finally {
      archiving.release();
      moving.release();
    }
    const orphan = await pool.query(
      `select count(*)::int as n from public.bookings bk join public.barbers b on b.id = bk.barber_id
       where not b.active and bk.status = 'confirme' and bk.ends_at > now()`,
    );
    expect(orphan.rows[0].n).toBe(0);
    await pool.query(`update public.bookings set status = 'annule', cancelled_at = now() where id = $1`, [pastId]);

    // F-2 : une chaise ne revient pas sans prestation active.
    await owner(`select public.admin_archive_barber($1::uuid)`, [ousmane]);
    await owner(`select public.admin_set_service($1::uuid, $2::uuid, false)`, [ousmane, serviceId]);
    await owner(`select public.admin_archive_service($1::uuid)`, [rasage]);
    await expect(owner(`select public.admin_reactivate_barber($1::uuid)`, [ousmane])).rejects.toThrow(
      /Ousmane n’offre plus aucune prestation active/,
    );
    const stillArchived = await pool.query(`select active from public.barbers where id = $1`, [ousmane]);
    expect(stillArchived.rows[0].active).toBe(false);

    // F-1 : ni la première connexion, ni un changement de rôle n’activent un coiffeur sur une chaise retirée.
    const lateInvite = '66666666-6666-4666-8666-666666666666';
    await insertUser(pool, lateInvite, 'ousmane@lenanometre.ca', 'Ousmane Diallo', 'coiffeur', ousmane);
    await pool.query(`update public.profiles set active = false, invited_at = now() where id = $1`, [lateInvite]);
    await pool.query(`update auth.users set last_sign_in_at = now() where id = $1`, [lateInvite]);
    const blocked = await pool.query(`select active, invited_at from public.profiles where id = $1`, [lateInvite]);
    expect(blocked.rows[0]).toEqual({ active: false, invited_at: null });
    const blockedAudit = await pool.query(
      `select detail->>'raison' as raison from public.audit_log where action = 'activation_bloquee' and entity_id = $1`,
      [lateInvite],
    );
    expect(blockedAudit.rows.map((row) => row.raison)).toEqual(['chaise_retiree']);
    const coOwner = '77777777-7777-4777-8777-777777777777';
    await insertUser(pool, coOwner, 'associe@lenanometre.ca', 'Associé', 'proprietaire', ousmane);
    await expect(owner(`select public.admin_set_role($1::uuid, 'coiffeur')`, [coOwner])).rejects.toThrow(/chaise de ce coiffeur est retirée/);
    const coOwnerRow = await pool.query(`select role::text as role, active from public.profiles where id = $1`, [coOwner]);
    expect(coOwnerRow.rows[0]).toEqual({ role: 'proprietaire', active: true });

    // F-2 (suite) : une prestation ajoutée sur la chaise retirée permet la réactivation.
    await owner(`select public.admin_set_service($1::uuid, $2::uuid, true)`, [ousmane, serviceId]);
    await owner(`select public.admin_reactivate_barber($1::uuid)`, [ousmane]);
    // Sur une chaise active, le changement de rôle reste possible.
    await owner(`select public.admin_set_role($1::uuid, 'coiffeur')`, [coOwner]);
    await owner(`select public.admin_set_role($1::uuid, 'proprietaire')`, [coOwner]);
    await pool.query(`update public.profiles set active = false where id = $1`, [coOwner]);

    // F-5 : plafond de 10 invitations par heure et par propriétaire, réservé à la clé de service.
    const claim = `select public.claim_invite_attempt($1::uuid) as ok`;
    for (const role of ['anon', 'authenticated'] as const) {
      const allowed = await pool.query(`select has_function_privilege($1, 'public.claim_invite_attempt(uuid)', 'execute') as ok`, [role]);
      expect(allowed.rows[0].ok).toBe(false);
    }
    await expect(owner(claim, [ownerId])).rejects.toThrow(/permission denied/);
    await pool.query(`delete from public.invite_attempts where owner_id = $1`, [ownerId]);
    const answers: boolean[] = [];
    for (let index = 0; index < 11; index += 1) {
      const result = await withRole(pool, 'service_role', {}, (client) => client.query<{ ok: boolean }>(claim, [ownerId]));
      answers.push(result.rows[0].ok);
    }
    expect(answers.filter(Boolean)).toHaveLength(10);
    expect(answers[10]).toBe(false);
    const capped = await pool.query(`select count(*)::int as n from public.audit_log where action = 'invitation_plafond' and actor_id = $1`, [ownerId]);
    expect(capped.rows[0].n).toBe(1);
    await pool.query(`update public.invite_attempts set created_at = now() - interval '2 hours' where owner_id = $1`, [ownerId]);
    const reopened = await withRole(pool, 'service_role', {}, (client) => client.query<{ ok: boolean }>(claim, [ownerId]));
    expect(reopened.rows[0].ok).toBe(true);
    await pool.query(`delete from public.invite_attempts where owner_id = $1`, [ownerId]);
    const rls = await pool.query(`select relrowsecurity from pg_class where oid = 'public.invite_attempts'::regclass`);
    expect(rls.rows[0].relrowsecurity).toBe(true);
    await expect(
      withRole(pool, 'authenticated', { sub: ownerId, aal: 'aal2' }, (client) => client.query(`select * from public.invite_attempts`)),
    ).rejects.toThrow(/permission denied/);

    const config = await pool.query<{ proname: string; cfg: string }>(
      `select p.proname, array_to_string(p.proconfig, ' ') as cfg from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('admin_set_weekday', 'admin_set_role', 'activate_invited_profile', 'claim_invite_attempt',
         'admin_reactivate_barber', 'admin_set_service', 'admin_move', 'list_slots')`,
    );
    expect(config.rows).toHaveLength(8);
    for (const fn of config.rows) {
      expect(fn.cfg, fn.proname).toMatch(/search_path=""/);
      expect(fn.cfg, fn.proname).not.toMatch(/search_path=public/);
    }
    await owner(`select public.admin_reactivate_service($1::uuid)`, [rasage]);
    await freeClient();
  });

  it('suivis du catalogue : N-1 protège les rendez-vous d’une prestation, N-4 exige un coiffeur actif', async () => {
    const owner = <T,>(sql: string, params: unknown[] = []) =>
      withRole(pool, 'authenticated', { sub: ownerId, aal: 'aal2' }, (client) => client.query<T & pg.QueryResultRow>(sql, params));
    const asClient = <T,>(sql: string, params: unknown[] = []) =>
      withRole(pool, 'authenticated', { sub: clientId, aal: 'aal1' }, (client) => client.query<T & pg.QueryResultRow>(sql, params));
    const freeClient = async () => {
      await pool.query(`delete from public.booking_attempts where user_id = $1`, [clientId]);
      await pool.query(
        `update public.bookings set status = 'annule', cancelled_at = now()
         where client_id = $1 and starts_at > now() and status in ('confirme', 'en_attente_paiement')`,
        [clientId],
      );
    };
    await freeClient();
    const amadou = (
      await owner<{ id: string }>(`select public.admin_create_barber('Amadou Ba', 'Amadou', '', array[2,3,4,5,6], array[$1::uuid]) as id`, [serviceId])
    ).rows[0].id;
    const taille = (
      await owner<{ id: string }>(`select public.admin_create_service('Taille de barbe test', '', 30, 2000, array[$1::uuid]) as id`, [amadou])
    ).rows[0].id;
    const setService = `select public.admin_set_service($1::uuid, $2::uuid, $3::boolean)`;

    // N-1 : un rendez-vous à venir pour ce couple bloque le retrait, avec le nombre et le nom.
    const thursday = upcoming(4);
    const booked = await asClient<{ data: { ok: boolean; id: string } }>(
      `select public.create_booking($1::uuid, $2::uuid, $3::date, 660, 'sur_place'::public.payment_method, false, null) as data`,
      [serviceId, amadou, thursday],
    );
    expect(booked.rows[0].data.ok).toBe(true);
    await expect(owner(setService, [amadou, serviceId, false])).rejects.toThrow(
      'Amadou a encore 1 rendez-vous à venir pour « Coupe classique ». Déplace-les ou annule-les dans l’agenda, puis réessaie.',
    );
    const kept = await pool.query(`select count(*)::int as n from public.barber_services where barber_id = $1 and service_id = $2`, [amadou, serviceId]);
    expect(kept.rows[0].n).toBe(1);
    // Le rendez-vous reste déplaçable, puisque le lien est gardé.
    await owner(`select public.admin_move($1::uuid, $2::date, 600)`, [booked.rows[0].data.id, addDays(thursday, 7)]);
    await expect(owner(setService, [amadou, serviceId, false])).rejects.toThrow(/Amadou a encore 1 rendez-vous à venir pour « Coupe classique »/);
    // En attente de paiement compte aussi ; un rendez-vous annulé ou passé ne compte pas.
    await pool.query(`update public.bookings set status = 'en_attente_paiement' where id = $1`, [booked.rows[0].data.id]);
    await expect(owner(setService, [amadou, serviceId, false])).rejects.toThrow(/rendez-vous à venir pour/);
    const pastId = '99999999-9999-4999-8999-999999999993';
    await pool.query(
      `insert into public.bookings (
         id, client_id, client_name, barber_id, service_id, starts_at, ends_at, duration_minutes,
         price_cents, gst_cents, qst_cents, total_cents, payment_method, status
       ) values (
         $1, $2, 'Alex Gagnon', $3, $4, '2026-09-02 14:00:00+00', '2026-09-02 14:30:00+00', 30,
         3500, 175, 349, 4024, 'sur_place'::public.payment_method, 'confirme'::public.booking_status
       )`,
      [pastId, clientId, amadou, serviceId],
    );
    await pool.query(`update public.bookings set status = 'annule', cancelled_at = now() where id = $1`, [booked.rows[0].data.id]);
    // aal1 et client restent refusés.
    await expect(
      withRole(pool, 'authenticated', { sub: ownerId, aal: 'aal1' }, (client) => client.query(setService, [amadou, serviceId, false])),
    ).rejects.toThrow(/Vérification renforcée requise/);
    await expect(asClient(setService, [amadou, serviceId, false])).rejects.toThrow(/Accès refusé/);
    await owner(setService, [amadou, serviceId, false]);
    await owner(setService, [amadou, serviceId, false]);
    await owner(setService, [amadou, serviceId, true]);
    await owner(setService, [amadou, serviceId, true]);
    const serviceAudit = await pool.query<{ offerte: string }>(
      `select detail->>'offerte' as offerte from public.audit_log
       where action = 'coiffeur_prestation' and entity_id = $1 order by created_at, id`,
      [amadou],
    );
    // Seuls les vrais changements sont journalisés.
    expect(serviceAudit.rows.map((row) => row.offerte)).toEqual(['false', 'true']);

    // N-1 sous concurrence : la réservation tient la chaise, le retrait attend puis voit le rendez-vous.
    await freeClient();
    const booking = await openSession(pool, { sub: clientId, aal: 'aal1' });
    const removing = await openSession(pool, { sub: ownerId, aal: 'aal2' });
    try {
      const made = await booking.query<{ data: { ok: boolean } }>(
        `select public.create_booking($1::uuid, $2::uuid, $3::date, 720, 'sur_place'::public.payment_method, false, null) as data`,
        [serviceId, amadou, thursday],
      );
      expect(made.rows[0].data.ok).toBe(true);
      const outcome = removing.query(setService, [amadou, serviceId, false]).then(
        () => 'ok',
        (error: Error) => error.message,
      );
      await sleep(300);
      await booking.query('commit');
      expect(await outcome).toMatch(/Amadou a encore 1 rendez-vous à venir pour « Coupe classique »/);
      await removing.query('rollback');
    } finally {
      booking.release();
      removing.release();
    }
    const orphanBookings = await pool.query(
      `select count(*)::int as n from public.bookings bk
       where bk.status in ('confirme', 'en_attente_paiement') and bk.ends_at > now()
         and not exists (select 1 from public.barber_services bs where bs.barber_id = bk.barber_id and bs.service_id = bk.service_id)`,
    );
    expect(orphanBookings.rows[0].n).toBe(0);
    await freeClient();

    // N-4 : une prestation sans coiffeur actif ne revient pas au catalogue.
    const reactivate = `select public.admin_reactivate_service($1::uuid)`;
    const reactivateWith = `select public.admin_reactivate_service($1::uuid, $2::uuid[])`;
    await owner(`select public.admin_archive_service($1::uuid)`, [taille]);
    await owner(`select public.admin_archive_barber($1::uuid)`, [amadou]);
    await expect(owner(reactivate, [taille])).rejects.toThrow(
      '« Taille de barbe test » n’est faite par aucun coiffeur actif. Choisis au moins un coiffeur, puis réactive-la.',
    );
    await expect(owner(reactivateWith, [taille, [amadou]])).rejects.toThrow('Choisis au moins un coiffeur actif pour cette prestation.');
    await expect(owner(reactivateWith, [taille, ['00000000-0000-4000-8000-000000000999']])).rejects.toThrow(/au moins un coiffeur actif/);
    await expect(owner(`select public.admin_reactivate_service($1::uuid, array[null]::uuid[])`, [taille])).rejects.toThrow(/au moins un coiffeur actif/);
    await expect(
      withRole(pool, 'authenticated', { sub: ownerId, aal: 'aal1' }, (client) => client.query(reactivateWith, [taille, [barberId]])),
    ).rejects.toThrow(/Vérification renforcée requise/);
    await expect(asClient(reactivateWith, [taille, [barberId]])).rejects.toThrow(/Accès refusé/);
    await expect(withRole(pool, 'anon', {}, (client) => client.query(reactivateWith, [taille, [barberId]]))).rejects.toThrow(/permission denied/);
    const stillOff = await pool.query(`select active from public.services where id = $1`, [taille]);
    expect(stillOff.rows[0].active).toBe(false);
    const noLink = await pool.query(`select count(*)::int as n from public.barber_services where service_id = $1 and barber_id = $2`, [taille, barberId]);
    expect(noLink.rows[0].n).toBe(0);
    const anonView = await withRole(pool, 'anon', {}, (client) => client.query<{ data: { id: string }[] }>(`select public.visible_services() as data`));
    expect(anonView.rows[0].data.map((item) => item.id)).not.toContain(taille);

    // Choisir un coiffeur actif dans le même appel réactive la prestation et la rend réservable.
    await owner(reactivateWith, [taille, [barberId, barberId]]);
    const back = await pool.query(`select active from public.services where id = $1`, [taille]);
    expect(back.rows[0].active).toBe(true);
    const linked = await pool.query(`select count(*)::int as n from public.barber_services where service_id = $1 and barber_id = $2`, [taille, barberId]);
    expect(linked.rows[0].n).toBe(1);
    const slots = await withRole(pool, 'anon', {}, (client) =>
      client.query<{ data: { available: boolean }[] }>(`select public.list_slots($1::uuid, $2::date, $3::uuid) as data`, [taille, addDays(thursday, 14), barberId]),
    );
    expect(slots.rows[0].data.some((slot) => slot.available)).toBe(true);
    const revivalAudit = await pool.query<{ added: string }>(
      `select detail->>'coiffeurs_ajoutes' as added from public.audit_log where action = 'prestation_reactivation' and entity_id = $1`,
      [taille],
    );
    expect(revivalAudit.rows.map((row) => row.added)).toEqual(['1']);
    await expect(owner(reactivate, [taille])).rejects.toThrow(/déjà active/);

    // Sans choix, la réactivation passe quand un coiffeur actif la fait déjà.
    await owner(`select public.admin_archive_service($1::uuid)`, [taille]);
    await owner(reactivate, [taille]);

    // Mêmes garanties que les autres RPC : search_path vide, SECURITY DEFINER, pas d’ancienne signature.
    const fns = await pool.query<{ sig: string; cfg: string; secdef: boolean }>(
      `select p.oid::regprocedure::text as sig, array_to_string(p.proconfig, ' ') as cfg, p.prosecdef as secdef
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname in ('admin_set_service', 'admin_reactivate_service') order by 1`,
    );
    expect(fns.rows.map((row) => row.sig)).toEqual(['admin_reactivate_service(uuid,uuid[])', 'admin_set_service(uuid,uuid,boolean)']);
    for (const fn of fns.rows) {
      expect(fn.secdef, fn.sig).toBe(true);
      expect(fn.cfg, fn.sig).toMatch(/search_path=""/);
    }
    for (const role of ['anon', 'public'] as const) {
      const allowed = await pool.query(
        role === 'public'
          ? `select bool_or(acl.privilege_type = 'EXECUTE') as ok from pg_proc p, aclexplode(p.proacl) acl
             where p.oid = 'public.admin_reactivate_service(uuid,uuid[])'::regprocedure and acl.grantee = 0`
          : `select has_function_privilege('anon', 'public.admin_reactivate_service(uuid,uuid[])', 'execute') as ok`,
      );
      expect(allowed.rows[0].ok ?? false, role).toBe(false);
    }
  });

  it('suivis de la revue : horaires du salon, prix, fiche prestation, réassignation et tableau 30 jours', async () => {
    const owner = <T,>(sql: string, params: unknown[] = []) =>
      withRole(pool, 'authenticated', { sub: ownerId, aal: 'aal2' }, (client) => client.query<T & pg.QueryResultRow>(sql, params));
    const ownerAal1 = (sql: string, params: unknown[] = []) =>
      withRole(pool, 'authenticated', { sub: ownerId, aal: 'aal1' }, (client) => client.query(sql, params));
    const asClient = <T,>(sql: string, params: unknown[] = []) =>
      withRole(pool, 'authenticated', { sub: clientId, aal: 'aal1' }, (client) => client.query<T & pg.QueryResultRow>(sql, params));
    const freeClient = async () => {
      await pool.query(`delete from public.booking_attempts where user_id = $1`, [clientId]);
      await pool.query(
        `update public.bookings set status = 'annule', cancelled_at = now()
         where client_id = $1 and starts_at > now() and status in ('confirme', 'en_attente_paiement')`,
        [clientId],
      );
    };
    type Day = { weekday: number; open: boolean; openMinute: number; closeMinute: number };
    const allDay = (): Day[] => [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, open: true, openMinute: 0, closeMinute: 1440 }));
    const withDay = (weekday: number, patch: Partial<Day>) => JSON.stringify(allDay().map((day) => (day.weekday === weekday ? { ...day, ...patch } : day)));
    const setHours = (week: string, force = false) => owner(`select public.admin_set_salon_hours($1::jsonb, $2)`, [week, force]);
    await freeClient();

    // Par défaut : 7 jours, 24 h sur 24, et salon_public le dit.
    const salon = await withRole(pool, 'anon', {}, (client) => client.query<{ data: { week: Day[] }[] }>(`select public.salon_public() as data`));
    expect(salon.rows[0].data[0].week).toHaveLength(7);
    expect(salon.rows[0].data[0].week.every((day) => day.open && day.openMinute === 0 && day.closeMinute === 1440)).toBe(true);

    // Horaires : propriétaire aal2 seulement, validation en français.
    await expect(ownerAal1(`select public.admin_set_salon_hours($1::jsonb, false)`, [JSON.stringify(allDay())])).rejects.toThrow(/Vérification renforcée requise/);
    await expect(asClient(`select public.admin_set_salon_hours($1::jsonb, false)`, [JSON.stringify(allDay())])).rejects.toThrow(/Accès refusé/);
    await expect(setHours(withDay(3, { openMinute: 900, closeMinute: 600 }))).rejects.toThrow(/^L’heure de fermeture doit suivre l’heure d’ouverture/);
    await expect(setHours(JSON.stringify(allDay().map((day) => ({ ...day, open: false }))))).rejects.toThrow(/^Le salon doit ouvrir au moins un jour/);
    await expect(setHours(JSON.stringify(allDay().slice(0, 6)))).rejects.toThrow(/^Réglage invalide/);
    await expect(setHours(withDay(3, { openMinute: 7 }))).rejects.toThrow(/^Réglage invalide/);

    const service = (
      await owner<{ id: string }>(`select public.admin_create_service('Coupe revue', '', 30, 3000, array[$1::uuid]) as id`, [barberId])
    ).rows[0].id;
    const amine = (
      await owner<{ id: string }>(`select public.admin_create_barber('Amine Revue', 'Amine', '', array[0,1,2,3,4,5,6], array[$1::uuid]) as id`, [service])
    ).rows[0].id;
    const sami = (
      await owner<{ id: string }>(`select public.admin_create_barber('Sami Revue', 'Sami', '', array[0,1,2,3,4,5,6], array[$1::uuid]) as id`, [service])
    ).rows[0].id;
    const slots = (date: string) =>
      withRole(pool, 'anon', {}, (client) =>
        client.query<{ data: { startMinute: number }[] }>(`select public.list_slots($1::uuid, $2::date, $3::uuid) as data`, [service, date, amine]),
      ).then((result) => result.rows[0].data.map((slot) => slot.startMinute));
    const book = (barber: string, date: string, start: number) =>
      asClient<{ data: { ok: boolean; id?: string; error?: string } }>(
        `select public.create_booking($1::uuid, $2::uuid, $3::date, $4, 'sur_place'::public.payment_method, false, null) as data`,
        [service, barber, date, start],
      );

    // Créneaux = horaires du salon ∩ disponibilités du coiffeur ; journée complète par défaut.
    const sunday = upcoming(0);
    const sundaySlots = await slots(sunday);
    expect(sundaySlots[0]).toBe(0);
    expect(sundaySlots.at(-1)).toBe(1410);
    const early = await book(amine, sunday, 60);
    expect(early.rows[0].data.ok).toBe(true);

    // Fermer le dimanche touche un rendez-vous : refusé sans force, puis forcé et journalisé.
    await expect(setHours(withDay(0, { open: false }))).rejects.toThrow(/sortent des nouvelles heures \(1\)/);
    await setHours(withDay(0, { open: false }), true);
    expect(await slots(sunday)).toEqual([]);
    const closed = await book(amine, sunday, 600);
    expect(closed.rows[0].data.ok).toBe(false);
    const audit = await pool.query<{ detail: { force: boolean } }>(`select detail from public.audit_log where action = 'salon_horaires' order by created_at desc limit 1`);
    expect(audit.rows[0].detail.force).toBe(true);
    await pool.query(`update public.bookings set status = 'annule', cancelled_at = now() where id = $1`, [early.rows[0].data.id]);
    await freeClient();

    // Heures sur mesure le mercredi : 10 h à 14 h.
    const wednesday = upcoming(3);
    await setHours(withDay(3, { openMinute: 600, closeMinute: 840 }));
    const wednesdaySlots = await slots(wednesday);
    expect(wednesdaySlots[0]).toBe(600);
    expect(wednesdaySlots.at(-1)).toBe(810);
    expect((await book(amine, wednesday, 540)).rows[0].data.ok).toBe(false);
    await freeClient();
    await setHours(JSON.stringify(allDay()));

    // Prix : aal2, journal ancien/nouveau, historique lisible par le propriétaire seulement.
    await expect(ownerAal1(`select public.admin_update_service($1::uuid, 3200)`, [service])).rejects.toThrow(/Vérification renforcée requise/);
    await owner(`select public.admin_update_service($1::uuid, 3200)`, [service]);
    await owner(`select public.admin_update_service($1::uuid, 3200)`, [service]);
    await owner(`select public.admin_update_service($1::uuid, 3400)`, [service]);
    const history = await owner<{ data: { oldCents: number; newCents: number }[] }>(`select public.admin_service_price_history($1::uuid) as data`, [service]);
    expect(history.rows[0].data.map((row) => [row.oldCents, row.newCents])).toEqual([
      [3200, 3400],
      [3000, 3200],
    ]);
    await expect(asClient(`select public.admin_service_price_history($1::uuid)`, [service])).rejects.toThrow(/Accès refusé/);

    // Fiche prestation : nom, description, durée.
    await expect(owner(`select public.admin_update_service_details($1::uuid, 'Coupe classique', '', 30)`, [service])).rejects.toThrow(/porte déjà ce nom/);
    await expect(owner(`select public.admin_update_service_details($1::uuid, 'Coupe revue', '', 7)`, [service])).rejects.toThrow(/^Durée invalide/);
    await owner(`select public.admin_update_service_details($1::uuid, '  Coupe revue longue ', 'Avec finition', 45)`, [service]);
    const details = await pool.query(`select name, description, duration_minutes from public.services where id = $1`, [service]);
    expect(details.rows[0]).toEqual({ name: 'Coupe revue longue', description: 'Avec finition', duration_minutes: 45 });
    const detailAudit = await pool.query(`select count(*)::int as n from public.audit_log where action = 'prestation_modification' and entity_id = $1`, [service]);
    expect(detailAudit.rows[0].n).toBe(1);

    await pool.query(`insert into public.notification_prefs (user_id, enabled) values ($1, true) on conflict (user_id) do update set enabled = true`, [clientId]);
    // Réassignation : un rendez-vous part chez Sami, l’autre reste (Sami est déjà pris).
    const thursday = upcoming(4);
    const first = await book(amine, thursday, 600);
    expect(first.rows[0].data.ok).toBe(true);
    await freeClientAttempts();
    const second = await book(amine, thursday, 720);
    expect(second.rows[0].data.ok).toBe(true);
    await pool.query(
      `insert into public.blocked_slots (barber_id, starts_at, ends_at, reason)
       values ($1, ($2::date + time '12:00') at time zone 'America/Toronto', ($2::date + time '13:30') at time zone 'America/Toronto', 'Congé')`,
      [sami, thursday],
    );
    await expect(owner(`select public.admin_reassign_barber_bookings($1::uuid, $1::uuid)`, [amine])).rejects.toThrow(/^Choisis un autre coiffeur actif/);
    await expect(ownerAal1(`select public.admin_reassign_barber_bookings($1::uuid, $2::uuid)`, [amine, sami])).rejects.toThrow(/Vérification renforcée requise/);
    const moved = await owner<{ data: { moved: number; kept: number } }>(`select public.admin_reassign_barber_bookings($1::uuid, $2::uuid) as data`, [amine, sami]);
    expect(moved.rows[0].data).toEqual({ moved: 1, kept: 1 });
    const owners = await pool.query(`select id, barber_id from public.bookings where id = any($1::uuid[])`, [[first.rows[0].data.id, second.rows[0].data.id]]);
    expect(Object.fromEntries(owners.rows.map((row) => [row.id, row.barber_id]))).toEqual({
      [first.rows[0].data.id!]: sami,
      [second.rows[0].data.id!]: amine,
    });
    const notice = await pool.query(`select count(*)::int as n from public.notification_jobs where booking_id = $1 and kind = 'changement'`, [first.rows[0].data.id]);
    expect(notice.rows[0].n).toBeGreaterThan(0);
    const reassignAudit = await pool.query(`select detail from public.audit_log where action = 'coiffeur_reassignation' and entity_id = $1`, [amine]);
    expect(reassignAudit.rows[0].detail).toMatchObject({ reassignes: 1, restants: 1 });
    await freeClient();

    // Tableau 30 jours : bornes et annulations par coiffeur.
    const today = torontoToday();
    const board = await owner<{ data: { from: string; to: string; perBarber: { name: string; cancelled: number }[] } }>(
      `select public.admin_dashboard($1::date, '30j') as data`,
      [today],
    );
    expect(board.rows[0].data.from).toBe(addDays(today, -29));
    expect(board.rows[0].data.to).toBe(today);
    expect(board.rows[0].data.perBarber.every((row) => typeof row.cancelled === 'number')).toBe(true);
    await expect(ownerAal1(`select public.admin_dashboard($1::date, '30j')`, [today])).rejects.toThrow(/Vérification renforcée requise/);

    async function freeClientAttempts() {
      await pool.query(`delete from public.booking_attempts where user_id = $1`, [clientId]);
    }
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

/** Date du jour à Toronto, au format AAAA-MM-JJ. */
function torontoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date());
}

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
}

/** Prochain jour de semaine donné (0 = dimanche), au moins deux jours après aujourd’hui à Toronto. */
function upcoming(weekday: number): string {
  let date = addDays(torontoToday(), 2);
  while (new Date(`${date}T00:00:00Z`).getUTCDay() !== weekday) {
    date = addDays(date, 1);
  }
  return date;
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

async function openSession(pool: pg.Pool, claims: Claims): Promise<pg.PoolClient> {
  const client = await pool.connect();
  await client.query('begin');
  await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [claims.sub ?? '']);
  await client.query(`select set_config('request.jwt.claim.role', 'authenticated', true)`);
  await client.query(`select set_config('request.jwt.claims', $1, true)`, [
    JSON.stringify({ aal: claims.aal ?? 'aal1', role: 'authenticated', sub: claims.sub ?? '' }),
  ]);
  await client.query('set local role authenticated');
  return client;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
