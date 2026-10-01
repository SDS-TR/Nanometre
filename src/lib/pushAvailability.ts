/**
 * Les notifications distantes sont absentes d’Expo Go depuis le SDK 53.
 * Importer `expo-notifications` y lève une erreur sur Android.
 *
 * `Constants.executionEnvironment === 'storeClient'` ne suffit pas : ce même
 * environnement couvre aussi un development build (`expo-dev-client`), où le
 * push doit rester actif. Le critère fiable est le module natif Expo Go.
 */
export function remotePushSupported(input: { runningInExpoGo: boolean }): boolean {
  return !input.runningInExpoGo;
}
