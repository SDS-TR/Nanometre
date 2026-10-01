import type { BottomTabBarProps } from 'expo-router/tabs';
import { CalendarDays, LayoutDashboard, Star, SunMedium, Users, Wallet, Settings2 } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { Text } from './Text';

type Role = 'proprietaire' | 'coiffeur';

const ownerTabs = [
  { name: 'index', label: 'Tableau', icon: LayoutDashboard },
  { name: 'agenda', label: 'Agenda', icon: CalendarDays },
  { name: 'paiements', label: 'Paiements', icon: Wallet },
  { name: 'gestion', label: 'Gestion', icon: Settings2 },
];

const barberTabs = [
  { name: 'index', label: 'Ma journée', icon: SunMedium },
  { name: 'agenda', label: 'Agenda', icon: CalendarDays },
  { name: 'clients', label: 'Clients', icon: Users },
  { name: 'avis', label: 'Avis', icon: Star },
];

type Props = BottomTabBarProps & { role: Role };

export function TabBarAdmin({ role, state, navigation }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const items = role === 'proprietaire' ? ownerTabs : barberTabs;
  return (
    <View
      style={{
        flexDirection: 'row',
        paddingBottom: insets.bottom,
        backgroundColor: theme.color.bg.elevated,
        borderTopWidth: 1,
        borderTopColor: theme.color.border.default,
      }}
    >
      {items.map((item) => {
        const index = state.routes.findIndex((route) => route.name === item.name);
        const active = state.index === index;
        const color = active ? theme.color.accent.default : theme.color.text.muted;
        const Icon = item.icon;
        return (
          <Pressable
            key={item.name}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={item.label}
            onPress={() => navigation.navigate(item.name)}
            style={{ flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center', gap: 2 }}
          >
            <Icon color={color} size={22} />
            <Text variant="caption" maxFontSizeMultiplier={1.2} color={color}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
