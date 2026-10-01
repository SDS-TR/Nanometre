import { Redirect, Tabs, useSegments } from 'expo-router';
import { LoadingBlock } from '../../../src/components/StateView';
import { TabBarAdmin } from '../../../src/components/TabBarAdmin';
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
  const role = user.role === 'coiffeur' ? 'coiffeur' : 'proprietaire';
  const owner = role === 'proprietaire';
  return (
    <Tabs
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: theme.color.bg.default } }}
      tabBar={(props) => <TabBarAdmin {...props} role={role} />}
    >
      <Tabs.Screen name="index" options={{ title: owner ? 'Tableau' : 'Ma journée' }} />
      <Tabs.Screen name="agenda" options={{ title: 'Agenda' }} />
      <Tabs.Screen name="paiements" options={{ title: 'Paiements', href: owner ? '/admin/paiements' : null }} />
      <Tabs.Screen name="gestion" options={{ title: 'Gestion', href: owner ? '/admin/gestion' : null }} />
      <Tabs.Screen name="clients" options={{ title: 'Clients', href: owner ? null : '/admin/clients' }} />
      <Tabs.Screen name="avis" options={{ title: 'Avis', href: owner ? null : '/admin/avis' }} />
      <Tabs.Screen name="acces-refuse" options={{ href: null }} />
    </Tabs>
  );
}
