import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';
import { scrubBreadcrumb, scrubEvent } from './sentryScrub';

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

export function sentryEnabled(): boolean {
  return Boolean(dsn);
}

if (dsn) {
  Sentry.init({
    dsn,
    environment: __DEV__ ? 'development' : 'production',
    release: Constants.expoConfig?.version ?? '0.0.0',
    sendDefaultPii: false,
    enableAutoSessionTracking: true,
    beforeSend(event) {
      return scrubEvent(event);
    },
    beforeBreadcrumb(breadcrumb) {
      return scrubBreadcrumb(breadcrumb);
    },
  });
}

/** Envoie l’erreur d’origine, pile comprise. Le nettoyage est dans beforeSend, pas ici. */
export function reportError(error: unknown): void {
  if (!dsn) {
    return;
  }
  Sentry.captureException(error);
}
