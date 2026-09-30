import { Stack } from 'expo-router';
import { SCREEN_MS } from '../../src/motion';
import { BookingDraftProvider } from '../../src/providers/BookingDraft';
import { useTheme } from '../../src/theme';

export default function ReserverLayout() {
  const theme = useTheme();
  return (
    <BookingDraftProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          animationDuration: SCREEN_MS,
          contentStyle: { backgroundColor: theme.color.bg.default },
        }}
      />
    </BookingDraftProvider>
  );
}
