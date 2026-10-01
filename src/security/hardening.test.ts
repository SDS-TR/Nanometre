import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { accessLevel, planTeamInvite } from '../../supabase/functions/invite-team-member/logic';
import { createLocalRepository } from '../data/localRepository';
import { decryptSession, encryptSession } from '../data/sessionCrypto';
import { memoryStore } from '../data/storage';
import { scopeBarber } from '../domain';
import { demoLoginPrefill } from '../lib/demoAuth';
import { googlePayTestEnv } from '../lib/googlePay';
import { passkeyPhases, passkeyRpId, passkeysAvailable } from '../lib/passkey';
import { cronAuthorized, paymentIsConsistent, paymentIntentIdempotencyKey, refundIdempotencyKey } from '../lib/payments';
import { maskClientName } from '../lib/privacy';
import { assertRuntimeConfig } from '../lib/productionConfig';
import { safeNext } from '../lib/safeNext';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const hardening = read('../../supabase/migrations/20261001160100_security_hardening.sql');
const webhook = read('../../supabase/functions/stripe-webhook/index.ts');
const refundFn = read('../../supabase/functions/process-refund/index.ts');
const dispatch = read('../../supabase/functions/dispatch-notifications/index.ts');
const intent = read('../../supabase/functions/create-payment-intent/index.ts');
const repo = read('../data/supabaseRepository.ts');
const seed = read('../../supabase/seed.sql');
const hosted = read('../../scripts/seed-hosted.mjs');

describe('durcissement', () => {
  it('ferme la confirmation de paiement au client', () => {
    expect(hardening).toContain('drop function if exists public.confirm_online_payment(uuid)');
    expect(hardening).toContain("if auth.role() is distinct from 'service_role'");
    expect(hardening).toContain('p.stripe_payment_intent_id is distinct from p_intent');
    expect(hardening).toContain("lower(p_currency) <> 'cad'");
    expect(hardening).toContain('revoke all on function public.confirm_online_payment(uuid, text, int, text) from public, anon, authenticated');
    expect(hardening).toContain('grant execute on function public.confirm_online_payment(uuid, text, int, text) to service_role');
    expect(hardening).not.toContain('grant execute on function public.confirm_online_payment(uuid, text, int, text) to authenticated');
    expect(repo).not.toContain('confirm_online_payment');
    expect(webhook).toContain('constructEventAsync');
    expect(webhook).toContain('createSubtleCryptoProvider');
    expect(webhook).toContain('p_amount: pi.amount_received');
    expect(webhook).toContain('p_currency: pi.currency');
    expect(webhook).toContain('payment_intent.payment_failed');
    expect(webhook).toContain('charge.refunded');
    expect(webhook).toContain('charge.dispute.created');
  });

  it('retire enqueue et validate_promo du rôle anon', () => {
    expect(hardening).toContain('revoke all on function public.enqueue_booking_notifications(uuid, text, text, text) from public, anon, authenticated');
    expect(hardening).toContain('revoke all on function public.trg_booking_notifications() from public, anon, authenticated');
    expect(hardening).toContain('alter default privileges in schema public revoke execute on functions from public, anon, authenticated');
    expect(hardening).toContain('revoke all on function public.validate_promo(text, date, int) from public, anon');
    expect(hardening).toContain('grant execute on function public.validate_promo(text, date, int) to authenticated');
    expect(hardening).toContain('revoke all on function public.anonymize_client(uuid) from public, anon, authenticated');
    expect(hardening).toContain('grant execute on function public.anonymize_client(uuid) to service_role');
  });

  it('émet le remboursement chez Stripe et masque les autres failles SQL', () => {
    expect(refundFn).toContain('stripe.refunds.create');
    expect(refundFn).toContain('refund-${bookingId}-cancel');
    expect(refundFn).toContain('refund-${bookingId}-fee');
    expect(hardening).toContain("'remboursement_en_cours'");
    expect(hardening).toContain('coiffeur_requires_barber');
    expect(hardening).toContain('if v_mine is null');
    expect(hardening).toContain("coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2'");
    expect(hardening).toContain('Vérification renforcée requise');
    expect(hardening).toContain("left(split_part(btrim(r.client_name), ' ', 2), 1)");
    expect(hardening).toContain('promo_redemptions');
    expect(hardening).toContain("b.status <> 'en_attente_paiement' or b.promo_code is not null");
    expect(hardening).toContain('Tu as déjà trois rendez-vous à venir.');
    expect(hardening).toContain("interval '15 minutes'");
    expect(hardening).toContain('Ce téléphone est déjà lié à un autre compte.');
    expect(hardening).toContain('clear_my_push_tokens');
    expect(hardening).toContain("status = 'en_attente_paiement'");
    expect(hardening).toContain('Annule d’abord le paiement en cours.');
    expect(hardening).toContain('guest:');
    expect(hardening).toContain("interval '24 months'");
  });

  it('vérifie le cron, l’idempotence et l’import npm', () => {
    expect(dispatch).toContain('CRON_SECRET');
    expect(dispatch).toContain('EXPO_ACCESS_TOKEN');
    expect(dispatch).toContain("npm:@supabase/supabase-js@2.117.2");
    expect(dispatch).not.toContain('esm.sh');
    expect(dispatch).toContain('DeviceNotRegistered');
    expect(intent).toContain('idempotencyKey');
    expect(intent).toContain('2025-08-27.basil');
    expect(intent).toContain('existing.amount === booking.total_cents');
    expect(cronAuthorized('Bearer secret-secret-secret', 'secret-secret-secret')).toBe(true);
    expect(cronAuthorized('Bearer anon', 'secret-secret-secret')).toBe(false);
    expect(cronAuthorized('Bearer short', 'short')).toBe(false);
    expect(paymentIntentIdempotencyKey('b1', 6324)).toBe('pi-b1-6324');
    expect(refundIdempotencyKey('b1', 'fee')).toBe('refund-b1-fee');
    expect(paymentIsConsistent({ storedIntentId: 'pi_1', intentId: 'pi_1', amountReceived: 6324, expectedCents: 6324, currency: 'CAD' })).toBe(true);
    expect(paymentIsConsistent({ storedIntentId: 'pi_1', intentId: 'pi_2', amountReceived: 6324, expectedCents: 6324, currency: 'cad' })).toBe(false);
  });

  it('garde les comptes de démo hors de la base hébergée', () => {
    expect(seed).not.toContain('nanometre');
    expect(seed).not.toContain('auth.users');
    expect(hosted).toContain('process.exit(1)');
    expect(hosted).not.toContain('seed.demo.sql');
    expect(demoLoginPrefill('local', true).password).toBe('nanometre');
    expect(demoLoginPrefill('local', false)).toEqual({ email: '', password: '' });
    expect(demoLoginPrefill('supabase', true)).toEqual({ email: '', password: '' });
  });

  it('borne la redirection, le périmètre et les passkeys', () => {
    expect(safeNext('/reserver/paiement')).toBe('/reserver/paiement');
    expect(safeNext('https://example.test')).toBe('/');
    expect(safeNext('//example.test')).toBe('/');
    expect(safeNext('lenanometre://admin')).toBe('/');
    expect(() => scopeBarber('coiffeur', null, null)).toThrow('Accès refusé');
    expect(() => planTeamInvite({ fullName: 'Noah', email: 'noah@exemple.ca', role: 'coiffeur', barberId: null })).toThrow(
      'Choisis la chaise de ce coiffeur.',
    );
    expect(passkeysAvailable).toBe(false);
    expect(passkeyRpId).toBe('lenanometre.ca');
    expect(passkeyPhases).toEqual(['A', 'B', 'C']);
    expect(maskClientName('Alex Gagnon')).toBe('Alex G.');
    const token = ['e30', btoa(JSON.stringify({ aal: 'aal2' })), 'sig'].join('.');
    expect(accessLevel(`Bearer ${token}`)).toBe('aal2');
    expect(accessLevel('Bearer e30.eyJhbGciOiJub25lIn0.sig')).toBe('aal1');
  });

  it('chiffre la session et refuse une prod incomplète', () => {
    const key = new Uint8Array(32).fill(7);
    const cipher = encryptSession(key, '{"access_token":"secret"}');
    expect(cipher).not.toContain('secret');
    expect(decryptSession(key, cipher)).toBe('{"access_token":"secret"}');
    expect(() => assertRuntimeConfig({ dev: false, source: undefined, url: '', key: '' })).toThrow('Configuration de production incomplète.');
    expect(() => assertRuntimeConfig({ dev: false, source: 'supabase', url: '', key: '' })).toThrow('Configuration de production incomplète.');
    expect(() => assertRuntimeConfig({ dev: false, source: 'local', url: '', key: '' })).not.toThrow();
    expect(() => assertRuntimeConfig({ dev: true, source: 'local', url: '', key: '' })).not.toThrow();
    expect(googlePayTestEnv({ dev: false, flag: undefined })).toBe(false);
    expect(googlePayTestEnv({ dev: true, flag: undefined })).toBe(true);
    expect(googlePayTestEnv({ dev: false, flag: 'true' })).toBe(true);
  });

  it('anonymise un client et protège le dernier propriétaire', async () => {
    const data = createLocalRepository(memoryStore());
    await data.ready;
    await data.signIn('karim@lenanometre.ca', 'nanometre');
    await expect(data.deleteAccount('SUPPRIMER')).rejects.toThrow('Il doit rester au moins un propriétaire actif.');
    await data.signOut();
    await data.signIn('alex.gagnon@exemple.ca', 'nanometre');
    await expect(data.deleteAccount('non')).rejects.toThrow('Écris SUPPRIMER pour confirmer.');
    await data.deleteAccount('SUPPRIMER');
    expect(data.getSession()).toBeNull();
    await expect(data.signIn('alex.gagnon@exemple.ca', 'nanometre')).rejects.toThrow('Courriel ou mot de passe incorrect.');
  });
});
