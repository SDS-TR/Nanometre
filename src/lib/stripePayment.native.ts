import { initPaymentSheet, presentPaymentSheet } from '@stripe/stripe-react-native';

export const nativePayAvailable = Boolean(process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY);

export async function presentNativePaymentSheet(clientSecret: string): Promise<'success' | 'canceled' | 'failed'> {
  const init = await initPaymentSheet({
    merchantDisplayName: 'Le Nanomètre',
    paymentIntentClientSecret: clientSecret,
    applePay: { merchantCountryCode: 'CA' },
    googlePay: { merchantCountryCode: 'CA', currencyCode: 'CAD', testEnv: true },
    defaultBillingDetails: { address: { country: 'CA' } },
    returnURL: 'lenanometre://stripe-redirect',
  });
  if (init.error) {
    return 'failed';
  }
  const presented = await presentPaymentSheet();
  if (presented.error) {
    return presented.error.code === 'Canceled' ? 'canceled' : 'failed';
  }
  return 'success';
}
