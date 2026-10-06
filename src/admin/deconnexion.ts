export const ROUTE_CONNEXION = '/connexion' as const;

type Session = { signOut(): Promise<void> };

/** Ferme la session, puis quitte l’espace courant. */
export async function deconnecter(repo: Session, aller: (path: typeof ROUTE_CONNEXION) => void): Promise<void> {
  await repo.signOut();
  aller(ROUTE_CONNEXION);
}

/** Confirmation légère : un refus laisse la session en place. */
export async function confirmerPuisDeconnecter(
  confirmer: () => boolean | Promise<boolean>,
  repo: Session,
  aller: (path: typeof ROUTE_CONNEXION) => void,
): Promise<void> {
  if (!(await confirmer())) {
    return;
  }
  await deconnecter(repo, aller);
}
