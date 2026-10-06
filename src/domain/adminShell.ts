type Role = 'client' | 'coiffeur' | 'proprietaire';

/** Un client n’a pas d’onglets d’équipe. Les monter provoque une boucle de navigation. */
export function adminShell(role: Role): 'refuse' | 'tabs' {
  return role === 'client' ? 'refuse' : 'tabs';
}

export function staffTabRole(role: Role): 'proprietaire' | 'coiffeur' | null {
  if (role === 'client') {
    return null;
  }
  return role === 'coiffeur' ? 'coiffeur' : 'proprietaire';
}
