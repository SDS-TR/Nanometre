export {};

declare global {
  namespace NodeJS {
    interface ProcessEnv {
      EXPO_PUBLIC_SUPABASE_URL?: string;
      EXPO_PUBLIC_SUPABASE_ANON_KEY?: string;
      EXPO_PUBLIC_DATA_SOURCE?: string;
      EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY?: string;
      EXPO_PUBLIC_GOOGLE_PAY_TEST?: string;
    }
  }
}
