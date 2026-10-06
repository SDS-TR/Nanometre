import { Redirect, Tabs, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import { LoadingBlock } from '../../../src/components/StateView';
import { TabBarAdmin } from '../../../src/components/TabBarAdmin';
import { getSupabase } from '../../../src/data';
import { adminShell, staffTabRole } from '../../../src/domain';
import { useAppState } from '../../../src/providers/AppState';
import { useTheme } from '../../../src/theme';
import AccesRefuseScreen from './acces-refuse';

export default function AdminLayout() {
  const theme = useTheme();
  const { user, ready, repo } = useAppState();
  const segments = useSegments();
  const denied = segments.includes('acces-refuse');
  const needsAal = Boolean(user && user.role === 'proprietaire' && repo.mode === 'supabase');
  const [aal, setAal] = useState<'aal1' | 'aal2' | null>(null);
  useEffect(() => {
    if (!needsAal) {
      return;
    }
    const supabase = getSupabase();
    if (!supabase) {
      return;
    }
    let cancelled = false;
    void supabase.auth.mfa.getAuthenticatorAssuranceLevel().then(({ data }) => {
      if (!cancelled) {
        setAal(data?.currentLevel === 'aal2' ? 'aal2' : 'aal1');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [needsAal]);
  const level = needsAal ? aal : 'aal2';
  if (needsAal && !getSupabase()) {
    return <Redirect href="/mfa" />;
  }
  if (!ready || (needsAal && level == null)) {
    return <LoadingBlock />;
  }
  if (!user) {
    return <Redirect href="/connexion?next=/admin" />;
  }
  if (needsAal && level !== 'aal2') {
    return <Redirect href="/mfa" />;
  }
  if (adminShell(user.role) === 'refuse') {
    return <AccesRefuseScreen />;
  }
  if (denied) {
    return <Redirect href="/admin" />;
  }
  const role = staffTabRole(user.role) ?? 'proprietaire';
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
