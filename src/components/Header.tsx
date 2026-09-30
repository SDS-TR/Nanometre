import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { Text } from './Text';

type Props = {
  title?: string;
  back?: boolean;
  right?: ReactNode;
};

export function Header({ title, back = false, right }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  return (
    <View
      style={{
        paddingTop: insets.top + theme.space[2],
        paddingHorizontal: theme.space[2],
        paddingBottom: theme.space[2],
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: theme.color.bg.default,
      }}
    >
      {back ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retour"
          onPress={() => router.back()}
          style={{ width: theme.touchTarget.min, height: theme.touchTarget.min, alignItems: 'center', justifyContent: 'center' }}
        >
          <ChevronLeft color={theme.color.text.primary} size={24} />
        </Pressable>
      ) : (
        <View style={{ width: theme.touchTarget.min }} />
      )}
      <View style={{ flex: 1 }}>
        {title ? (
          <Text variant="heading-sm" style={{ textAlign: 'center' }}>
            {title}
          </Text>
        ) : null}
      </View>
      <View style={{ width: theme.touchTarget.min, alignItems: 'flex-end' }}>{right}</View>
    </View>
  );
}
