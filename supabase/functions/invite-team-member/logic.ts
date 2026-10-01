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
  if (input.role === 'coiffeur' && (input.barberId == null || input.barberId === '')) {
    throw new Error('Choisis la chaise de ce coiffeur.');
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

/** aal du jeton déjà vérifié par Auth. aal1 si le claim est absent. */
export function accessLevel(authorization: string | null): 'aal1' | 'aal2' {
  if (!authorization) {
    return 'aal1';
  }
  const token = authorization.replace(/^Bearer\s+/i, '');
  const part = token.split('.')[1];
  if (!part) {
    return 'aal1';
  }
  try {
    const padded = part.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(globalThis.atob(padded)) as { aal?: unknown };
    return json.aal === 'aal2' ? 'aal2' : 'aal1';
  } catch {
    return 'aal1';
  }
}
