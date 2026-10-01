export type StaffInviteRole = 'coiffeur' | 'proprietaire';

export type TeamInvitePlan = {
  email: string;
  fullName: string;
  role: StaffInviteRole;
  barberId: string | null;
  metadata: { full_name: string };
  audit: {
    action: 'invitation';
    entity: 'profile';
    detail: { email: string; name: string; role: StaffInviteRole; barberId: string | null };
  };
};

export function planTeamInvite(input: {
  fullName: unknown;
  email: unknown;
  role: unknown;
  barberId: unknown;
}): TeamInvitePlan {
  const fullName = typeof input.fullName === 'string' ? input.fullName.trim() : '';
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  if (!fullName || !email.includes('@') || email.startsWith('@') || email.endsWith('@')) {
    throw new Error('Invitation incomplète.');
  }
  if (input.role !== 'coiffeur' && input.role !== 'proprietaire') {
    throw new Error('Accès refusé');
  }
  let barberId: string | null = null;
  if (input.barberId != null && input.barberId !== '') {
    if (typeof input.barberId !== 'string') {
      throw new Error('Coiffeur invalide.');
    }
    barberId = input.barberId;
  }
  return {
    email,
    fullName,
    role: input.role,
    barberId,
    metadata: { full_name: fullName },
    audit: {
      action: 'invitation',
      entity: 'profile',
      detail: { email, name: fullName, role: input.role, barberId },
    },
  };
}

export function inviteAck(): { invited: true } {
  return { invited: true };
}
