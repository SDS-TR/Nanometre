import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { inviteAck, planTeamInvite } from '../../supabase/functions/invite-team-member/logic';
import { createLocalRepository } from './localRepository';
import { memoryStore } from './storage';

describe('invitation équipe', () => {
  it('prépare le rôle et la chaise, sans secret', () => {
    const plan = planTeamInvite({
      fullName: ' Noah Pelletier ',
      email: 'Noah@Exemple.ca',
      role: 'coiffeur',
      barberId: '20000000-0000-4000-8000-000000000003',
    });
    expect(plan).toMatchObject({
      email: 'noah@exemple.ca',
      fullName: 'Noah Pelletier',
      role: 'coiffeur',
      barberId: '20000000-0000-4000-8000-000000000003',
      metadata: { full_name: 'Noah Pelletier' },
    });
    expect(plan.audit).toEqual({
      action: 'invitation',
      entity: 'profile',
      detail: {
        email: 'noah@exemple.ca',
        name: 'Noah Pelletier',
        role: 'coiffeur',
        barberId: '20000000-0000-4000-8000-000000000003',
      },
    });
    expect(inviteAck()).toEqual({ invited: true });
    expect(JSON.stringify({ plan, ack: inviteAck() })).not.toMatch(/password/i);
    expect(() => planTeamInvite({ fullName: 'Alex', email: 'alex@exemple.ca', role: 'client', barberId: null })).toThrow(
      'Accès refusé',
    );
  });

  it('ajoute le coiffeur en local et ne renvoie pas de mot de passe', async () => {
    const data = createLocalRepository(memoryStore());
    await data.ready;
    await data.signIn('julien.morel@lenanometre.ca', 'nanometre');
    await expect(
      data.inviteMember({
        fullName: 'Noah Pelletier',
        email: 'noah@lenanometre.ca',
        role: 'coiffeur',
        barberId: null,
      }),
    ).rejects.toThrow('Accès refusé');
    await data.signOut();
    await data.signIn('karim@lenanometre.ca', 'nanometre');
    const samuel = (await data.getBarbers()).find((barber) => barber.slug === 'samuel-tremblay');
    const result = await data.inviteMember({
      fullName: 'Noah Pelletier',
      email: 'noah@lenanometre.ca',
      role: 'coiffeur',
      barberId: samuel!.id,
    });
    expect(result).toEqual({ invited: true });
    expect(Object.keys(result)).toEqual(['invited']);
    const member = (await data.listTeam()).find((item) => item.email === 'noah@lenanometre.ca');
    expect(member).toMatchObject({ role: 'coiffeur', barberId: samuel!.id, active: true });
    expect((await data.listAudit()).some((entry) => entry.action === 'invitation' && entry.detail.includes('Noah Pelletier'))).toBe(
      true,
    );
    await data.signOut();
    const session = await data.signIn('noah@lenanometre.ca', 'nanometre');
    expect(session.role).toBe('coiffeur');
    expect(session.barberId).toBe(samuel!.id);
  });

  it('invite Auth côté serveur, lie le profil et journalise', () => {
    const source = readFileSync(new URL('../../supabase/functions/invite-team-member/index.ts', import.meta.url), 'utf8');
    const sql = readFileSync(new URL('../../supabase/migrations/20261001140000_team_invite.sql', import.meta.url), 'utf8');
    expect(source).toContain('inviteUserByEmail');
    expect(source).toContain('SUPABASE_SERVICE_ROLE_KEY');
    expect(source).toContain('barber_id');
    expect(source).toContain("from('audit_log')");
    expect(source).toContain('inviteAck()');
    expect(source).toContain('active: false');
    expect(source).toContain('https://lenanometre.ca/auth/callback');
    expect(source).toContain('Vérification renforcée requise');
    expect(source).not.toMatch(/password/i);
    expect(sql).toContain('L’invitation se fait par le serveur.');
    expect(sql).not.toMatch(/password/i);
  });
});