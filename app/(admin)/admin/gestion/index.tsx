import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { Header } from '../../../../src/components/Header';
import { ListItem } from '../../../../src/components/ListItem';
import { Screen } from '../../../../src/components/Screen';
import { StateMessage } from '../../../../src/components/StateView';
import { useAppState } from '../../../../src/providers/AppState';
import { useTheme } from '../../../../src/theme';

const links = [
  { href: '/admin/gestion/coiffeurs', title: 'Coiffeurs', subtitle: 'Ajouter, retirer, jours et prestations' },
  { href: '/admin/gestion/prestations', title: 'Prestations', subtitle: 'Ajouter, retirer, prix avant taxes' },
  { href: '/admin/gestion/avis', title: 'Avis', subtitle: 'Publier ou masquer' },
  { href: '/admin/gestion/clients', title: 'Clients', subtitle: 'Notes, historique, fidélité' },
  { href: '/admin/gestion/promos', title: 'Codes promo', subtitle: 'Pourcentage ou montant' },
  { href: '/admin/gestion/equipe', title: 'Équipe', subtitle: 'Inviter, rôle, désactiver' },
  { href: '/admin/gestion/horaires', title: 'Horaires du salon', subtitle: 'Jours ouverts et heures, jour par jour' },
  { href: '/admin/gestion/salon', title: 'Salon', subtitle: 'Annulation sur place' },
] as const;

export default function GestionScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { user } = useAppState();
  if (user?.role !== 'proprietaire') {
    return (
      <Screen>
        <Header title="Gestion" />
        <StateMessage title="Accès refusé" body="La gestion du salon est réservée au propriétaire." />
      </Screen>
    );
  }
  return (
    <Screen>
      <Header title="Gestion" />
      <View style={{ padding: theme.space[4], gap: theme.space[1] }}>
        {links.map((link) => (
          <ListItem key={link.href} title={link.title} subtitle={link.subtitle} onPress={() => router.push(link.href)} />
        ))}
      </View>
    </Screen>
  );
}
