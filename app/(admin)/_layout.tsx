import { Stack } from 'expo-router';
import { useTheme } from '../../src/theme';

export default function AdminGroupLayout() {
  const theme = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.color.bg.default } }} />;
}
