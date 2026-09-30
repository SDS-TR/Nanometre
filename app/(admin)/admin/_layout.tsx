import { Redirect, Stack, useSegments } from 'expo-router';
import { LoadingBlock } from '../../../src/components/StateView';
import { useAppState } from '../../../src/providers/AppState';
import { useTheme } from '../../../src/theme';

export default function AdminLayout() {
  const theme = useTheme();
  const { user, ready } = useAppState();
  const segments = useSegments();
  const denied = segments.includes('acces-refuse');
  if (!ready) {
    return <LoadingBlock />;
  }
  if (!user) {
    return <Redirect href="/connexion?next=/admin" />;
  }
  if (user.role === 'client' && !denied) {
    return <Redirect href="/admin/acces-refuse" />;
  }
  if (user.role !== 'client' && denied) {
    return <Redirect href="/admin" />;
  }
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.color.bg.default } }} />;
}
