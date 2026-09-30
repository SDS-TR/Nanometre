import type { ReactNode } from 'react';
import { StripeProvider } from '@stripe/stripe-react-native';

export function AppStripe({ children }: { children: ReactNode }) {
  return (
    <StripeProvider
      publishableKey={process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || 'pk_test_51NanometrePlaceholder'}
      merchantIdentifier="merchant.ca.lenanometre"
      urlScheme="lenanometre"
    >
      <>{children}</>
    </StripeProvider>
  );
}
