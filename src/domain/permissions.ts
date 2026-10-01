export type StaffRole = 'client' | 'coiffeur' | 'proprietaire';

export type StaffAction =
  | 'dashboard'
  | 'day'
  | 'agenda'
  | 'block'
  | 'move'
  | 'cancelClient'
  | 'clients'
  | 'loyalty'
  | 'reviewsRead'
  | 'reviewsModerate'
  | 'services'
  | 'promos'
  | 'payments'
  | 'refund'
  | 'barbers'
  | 'team'
  | 'settings'
  | 'honor';

const BARBER_ACTIONS = new Set<StaffAction>(['day', 'agenda', 'block', 'clients', 'reviewsRead', 'honor']);

export class AccessDeniedError extends Error {
  readonly status = 403;
  constructor() {
    super('Accès refusé');
    this.name = 'AccessDeniedError';
  }
}

export function isStaff(role: StaffRole): role is 'proprietaire' | 'coiffeur' {
  return role === 'proprietaire' || role === 'coiffeur';
}

export function can(role: StaffRole, action: StaffAction): boolean {
  if (role === 'proprietaire') {
    return true;
  }
  if (role === 'coiffeur') {
    return BARBER_ACTIONS.has(action);
  }
  return false;
}

export function assertCan(role: StaffRole, action: StaffAction): void {
  if (!can(role, action)) {
    throw new AccessDeniedError();
  }
}

/** Le coiffeur reste sur sa chaise. Le propriétaire peut viser n'importe quel coiffeur, ou tous. */
export function scopeBarber(role: StaffRole, ownBarberId: string | null, requested: string | null): string | null {
  if (role === 'proprietaire') {
    return requested;
  }
  if (role !== 'coiffeur' || !ownBarberId) {
    throw new AccessDeniedError();
  }
  if (requested && requested !== ownBarberId) {
    throw new AccessDeniedError();
  }
  return ownBarberId;
}

export function assertLastOwnerSurvives(input: {
  owners: { id: string; active: boolean }[];
  targetId: string;
  nextActive: boolean;
  nextRole: StaffRole;
}): void {
  const still = input.owners.filter((owner) => {
    if (owner.id !== input.targetId) {
      return owner.active;
    }
    return input.nextActive && input.nextRole === 'proprietaire';
  });
  if (still.length < 1) {
    throw new Error('Il doit rester au moins un propriétaire actif.');
  }
}
