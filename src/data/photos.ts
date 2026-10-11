export const photos = {
  hero: require('../../assets/photos/salon-hero.jpg'),
  'karim-b': require('../../assets/photos/karim-b.jpg'),
  'julien-morel': require('../../assets/photos/julien-morel.jpg'),
  'samuel-tremblay': require('../../assets/photos/samuel-tremblay.jpg'),
  'ousmane-diallo': require('../../assets/photos/ousmane-diallo.jpg'),
  'marco-rossi': require('../../assets/photos/marco-rossi.jpg'),
  'coupe-classique': require('../../assets/photos/coupe-classique.jpg'),
  'degrade-blanc': require('../../assets/photos/degrade-blanc.jpg'),
  'coupe-barbe': require('../../assets/photos/coupe-barbe.jpg'),
  'taille-barbe': require('../../assets/photos/taille-barbe.jpg'),
  'rasage-ancienne': require('../../assets/photos/rasage-ancienne.jpg'),
  'coupe-enfant': require('../../assets/photos/coupe-enfant.jpg'),
} as const;

export type PhotoKey = keyof typeof photos;

/** Vrai si la clé correspond à une photo livrée avec l’app. Sinon on affiche les initiales. */
export function hasPhoto(key: string | null | undefined): boolean {
  return Boolean(key && key in photos);
}

export function photoSource(key: string) {
  if (key in photos) {
    return photos[key as PhotoKey];
  }
  return photos.hero;
}
