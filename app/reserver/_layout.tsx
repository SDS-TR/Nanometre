import { Stack } from 'expo-router';
import { SCREEN_MS } from '../../src/motion';
import { useTheme } from '../../src/theme';

export default function ReserverLayout() {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        animationDuration: SCREEN_MS,
        contentStyle: { backgroundColor: theme.color.bg.default },
      }}
    />
  );
}
