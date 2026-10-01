import type { ReactNode } from 'react';
import { StripeProvider } from '@stripe/stripe-react-native';

export function AppStripe({ children }: { children: ReactNode }) {
  const publishableKey = process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!publishableKey) {
    return children;
  }
  return (
    <StripeProvider publishableKey={publishableKey} merchantIdentifier="merchant.ca.lenanometre" urlScheme="lenanometre">
      <>{children}</>
    </StripeProvider>
  );
}
