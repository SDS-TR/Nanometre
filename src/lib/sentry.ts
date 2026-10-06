import * as Sentry from '@sentry/react-native';
import { scrubUnknown } from './sentryScrub';

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

export function sentryEnabled(): boolean {
  return Boolean(dsn);
}

if (dsn) {
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    enableAutoSessionTracking: true,
    beforeSend(event) {
      return scrubUnknown(event) as typeof event;
    },
    beforeBreadcrumb(breadcrumb) {
      return scrubUnknown(breadcrumb) as typeof breadcrumb;
    },
  });
}

export function reportError(error: unknown): void {
  if (!dsn) {
    return;
  }
  const scrubbed = error instanceof Error ? new Error(String(scrubUnknown(error.message))) : error;
  Sentry.captureException(scrubbed);
}
