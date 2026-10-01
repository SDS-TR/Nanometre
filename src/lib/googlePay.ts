export function googlePayTestEnv(env: { dev: boolean; flag: string | undefined } = {
  dev: typeof __DEV__ !== 'undefined' && __DEV__,
  flag: process.env.EXPO_PUBLIC_GOOGLE_PAY_TEST,
}): boolean {
  if (env.flag === 'true') {
    return true;
  }
  if (env.flag === 'false') {
    return false;
  }
  return env.dev;
}
