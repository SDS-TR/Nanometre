import { Tabs } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/tabs';
import { CalendarDays, Home, Scissors, UserRound } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../src/components/Text';
import { useTheme } from '../../src/theme';

const items = [
  { name: 'index', label: 'Accueil', icon: Home },
  { name: 'coiffeurs', label: 'Coiffeurs', icon: Scissors },
  { name: 'rendez-vous', label: 'Rendez-vous', icon: CalendarDays },
  { name: 'profil', label: 'Profil', icon: UserRound },
];

export default function ClientLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props) => <ClientTabBar {...props} />}>
      <Tabs.Screen name="index" options={{ title: 'Accueil' }} />
      <Tabs.Screen name="coiffeurs" options={{ title: 'Coiffeurs' }} />
      <Tabs.Screen name="rendez-vous" options={{ title: 'Rendez-vous' }} />
      <Tabs.Screen name="profil" options={{ title: 'Profil' }} />
    </Tabs>
  );
}

function ClientTabBar({ state, navigation }: BottomTabBarProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
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
      {state.routes.map((route, index) => {
        const item = items.find((entry) => entry.name === route.name);
        if (!item) {
          return null;
        }
        const active = state.index === index;
        const color = active ? theme.color.accent.default : theme.color.text.muted;
        const Icon = item.icon;
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={item.label}
            onPress={() => navigation.navigate(route.name)}
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
