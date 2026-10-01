import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Avatar } from '../../src/components/Avatar';
import { Button } from '../../src/components/Button';
import { Header } from '../../src/components/Header';
import { ListItem } from '../../src/components/ListItem';
import { Screen } from '../../src/components/Screen';
import { SegmentedControl } from '../../src/components/SegmentedControl';
import { Text } from '../../src/components/Text';
import { useAsync } from '../../src/hooks/useAsync';
import { registerForPush } from '../../src/lib/push';
import { useAppState } from '../../src/providers/AppState';
import { useTheme, type ThemePreference } from '../../src/theme';

export default function ProfilScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user, repo, preference, setPreference } = useAppState();
  const opted = useAsync((repository) => (user ? repository.notificationOptIn() : Promise.resolve(false)), [user?.id]);
  const notices = useAsync((repository) => (user ? repository.listMyNotifications() : Promise.resolve([])), [user?.id]);
  const [note, setNote] = useState<string | null>(null);
  return (
    <Screen>
      <Header title="Profil" />
      <View style={{ padding: theme.space[4], gap: theme.space[5] }}>
        {user ? (
          <View style={{ flexDirection: 'row', gap: theme.space[3], alignItems: 'center' }}>
            <Avatar name={user.fullName} size="lg" />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="heading-sm">{user.fullName}</Text>
              <Text variant="body-sm" color={theme.color.text.secondary}>
                {user.email}
              </Text>
            </View>
          </View>
        ) : (
          <View style={{ gap: theme.space[3] }}>
            <Text variant="heading-md">Ton compte</Text>
            <Text variant="body-md" color={theme.color.text.secondary}>
              Garde tes rendez-vous, ta carte de fidélité et tes reçus au même endroit.
            </Text>
            <Button label="Connexion" onPress={() => router.push('/connexion')} />
            <Button label="Créer un compte" variant="secondary" onPress={() => router.push('/inscription')} />
          </View>
        )}
        <View style={{ gap: theme.space[2] }}>
          <Text variant="label-sm" color={theme.color.text.muted}>
            Apparence
          </Text>
          <SegmentedControl<ThemePreference>
            value={preference}
            onChange={setPreference}
            options={[
              { value: 'sombre', label: 'Sombre' },
              { value: 'clair', label: 'Clair' },
              { value: 'systeme', label: 'Système' },
            ]}
          />
        </View>
        {user ? (
          <View style={{ gap: theme.space[1] }}>
            <ListItem title="Carte de fidélité" subtitle="1 point par dollar, 10 coupes = 1 offerte" onPress={() => router.push('/fidelite')} />
            <ListItem
              title="Rappels"
              subtitle={opted.data ? 'Activés — confirmation, 24 h et 2 h avant' : 'Désactivés'}
              onPress={() => {
                const next = !opted.data;
                void repo.setNotificationOptIn(next).then(async () => {
                  if (next) {
                    const token = await registerForPush();
                    if (token) {
                      await repo.setPushToken(token);
                    }
                  }
                  setNote(next ? 'Tu recevras les avis de tes rendez-vous.' : 'Les avis sont coupés.');
                });
              }}
            />
            {note ? (
              <Text variant="body-sm" color={theme.color.text.secondary}>
                {note}
              </Text>
            ) : null}
            {notices.data?.slice(0, 4).map((item) => (
              <ListItem key={item.id} title={item.title} subtitle={item.body} onPress={() => router.push(item.path as '/rendez-vous')} />
            ))}
            <ListItem title="Clés d’accès" subtitle="Bientôt — les passkeys arriveront après cette phase" />
            {user.role !== 'client' ? (
              <ListItem title="Espace équipe" subtitle={user.role === 'proprietaire' ? 'Propriétaire' : 'Coiffeur'} onPress={() => router.push('/admin')} />
            ) : null}
            <Button
              label="Déconnexion"
              variant="ghost"
              onPress={() => {
                void repo.signOut();
              }}
            />
          </View>
        ) : null}
        <Text variant="caption" color={theme.color.text.muted}>
          Le Nanomètre · Québec · prix en dollars canadiens
        </Text>
      </View>
    </Screen>
  );
}
