export const nativePayAvailable = false;

export async function presentNativePaymentSheet(_clientSecret: string): Promise<'success' | 'canceled' | 'failed'> {
  return 'failed';
}
