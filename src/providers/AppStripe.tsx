import type { ReactNode } from 'react';

/** Secours web et résolution TypeScript. Metro charge `.native.tsx` sur iOS et Android. */
export function AppStripe({ children }: { children: ReactNode }) {
  return children;
}
