import { handleInviteRequest, INVITE_LIMIT_MESSAGE, type InviteRuntime } from './handler.ts';

const ownerId = '22222222-2222-4222-8222-222222222222';
const chairId = '20000000-0000-4000-8000-000000000003';

function token(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `Bearer ${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: ownerId, ...claims })}.signature`;
}

type Calls = { invites: string[]; claims: number; audits: number };

function fakeRuntime(options: { limit?: number; chairActive?: boolean; role?: string } = {}): InviteRuntime & { calls: Calls } {
  const calls: Calls = { invites: [], claims: 0, audits: 0 };
  const limit = options.limit ?? 10;
  return {
    calls,
    getUser: (authorization) => Promise.resolve(authorization.includes('refuse') ? null : { id: ownerId }),
    getActor: () => Promise.resolve({ role: options.role ?? 'proprietaire', active: true }),
    claimInviteAttempt: () => {
      calls.claims += 1;
      return Promise.resolve(calls.claims <= limit);
    },
    getBarber: (id) => Promise.resolve(id === chairId ? { id, active: options.chairActive ?? true } : null),
    inviteUserByEmail: (email) => {
      calls.invites.push(email);
      return Promise.resolve({ userId: crypto.randomUUID(), errorMessage: null });
    },
    upsertProfile: () => Promise.resolve({ ok: true }),
    insertAudit: () => {
      calls.audits += 1;
      return Promise.resolve({ ok: true });
    },
    redirectTo: 'https://lenanometre.ca/auth/callback',
  };
}

function request(authorization: string | null, body: Record<string, unknown>): Request {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (authorization) {
    headers.set('Authorization', authorization);
  }
  return new Request('http://localhost/invite-team-member', { method: 'POST', headers, body: JSON.stringify(body) });
}

const coiffeur = { fullName: 'Noah Pelletier', email: 'noah@exemple.ca', role: 'coiffeur', barberId: chairId };
const proprietaire = { fullName: 'Léa Roy', email: 'lea@exemple.ca', role: 'proprietaire', barberId: null };

async function expectStatus(response: Response, status: number, error?: string) {
  const body = await response.json();
  if (response.status !== status || (error !== undefined && body.error !== error)) {
    throw new Error(`attendu ${status} ${error ?? ''}, reçu ${response.status} ${JSON.stringify(body)}`);
  }
}

Deno.test('E-1 : un propriétaire en aal1 ne peut inviter ni coiffeur ni propriétaire', async () => {
  for (const body of [coiffeur, proprietaire]) {
    const runtime = fakeRuntime();
    await expectStatus(await handleInviteRequest(request(token({ aal: 'aal1' }), body), runtime), 403, 'Vérification renforcée requise');
    await expectStatus(await handleInviteRequest(request(token({}), body), runtime), 403, 'Vérification renforcée requise');
    if (runtime.calls.invites.length !== 0 || runtime.calls.claims !== 0) {
      throw new Error('aucune invitation ni tentative ne doit partir en aal1');
    }
  }
});

Deno.test('E-1 : un propriétaire en aal2 invite un coiffeur et un propriétaire', async () => {
  const runtime = fakeRuntime();
  await expectStatus(await handleInviteRequest(request(token({ aal: 'aal2' }), coiffeur), runtime), 200);
  await expectStatus(await handleInviteRequest(request(token({ aal: 'aal2' }), proprietaire), runtime), 200);
  if (runtime.calls.invites.join(',') !== 'noah@exemple.ca,lea@exemple.ca' || runtime.calls.audits !== 2) {
    throw new Error(`invitations inattendues ${JSON.stringify(runtime.calls)}`);
  }
});

Deno.test('refuse sans session, avec un jeton rejeté, ou pour un non-propriétaire', async () => {
  await expectStatus(await handleInviteRequest(request(null, coiffeur), fakeRuntime()), 401);
  await expectStatus(await handleInviteRequest(request('Bearer refuse', coiffeur), fakeRuntime()), 401);
  await expectStatus(await handleInviteRequest(request(token({ aal: 'aal2' }), coiffeur), fakeRuntime({ role: 'coiffeur' })), 403, 'Accès refusé');
  await expectStatus(await handleInviteRequest(new Request('http://localhost/', { method: 'GET' }), fakeRuntime()), 405);
  await expectStatus(await handleInviteRequest(request(token({ aal: 'aal2' }), coiffeur), { missing: true }), 500);
});

Deno.test('refuse une chaise retirée en aal2', async () => {
  const runtime = fakeRuntime({ chairActive: false });
  await expectStatus(
    await handleInviteRequest(request(token({ aal: 'aal2' }), coiffeur), runtime),
    400,
    'Ce coiffeur est retiré. Réactive-le avant de l’inviter.',
  );
  if (runtime.calls.invites.length !== 0) {
    throw new Error('pas d’invitation sur une chaise retirée');
  }
});

Deno.test('F-5 : au-delà du plafond, 429 en français et aucun courriel', async () => {
  const runtime = fakeRuntime({ limit: 10 });
  for (let index = 0; index < 10; index += 1) {
    const body = { ...coiffeur, email: `noah${index}@exemple.ca` };
    await expectStatus(await handleInviteRequest(request(token({ aal: 'aal2' }), body), runtime), 200);
  }
  await expectStatus(
    await handleInviteRequest(request(token({ aal: 'aal2' }), { ...coiffeur, email: 'onze@exemple.ca' }), runtime),
    429,
    INVITE_LIMIT_MESSAGE,
  );
  if (runtime.calls.invites.length !== 10 || runtime.calls.invites.includes('onze@exemple.ca')) {
    throw new Error(`le plafond doit bloquer l’envoi ${JSON.stringify(runtime.calls.invites)}`);
  }
});
