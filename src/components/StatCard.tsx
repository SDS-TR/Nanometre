import { View } from 'react-native';
import { useTheme } from '../theme';
import { Text } from './Text';

type Props = { label: string; value: string; hint?: string };

export function StatCard({ label, value, hint }: Props) {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        minWidth: 140,
        backgroundColor: theme.color.bg.elevated,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.color.border.default,
        padding: theme.space[4],
        gap: theme.space[1],
      }}
    >
      <Text variant="overline" color={theme.color.text.muted}>
        {label}
      </Text>
      <Text variant="heading-md">{value}</Text>
      {hint ? (
        <Text variant="caption" color={theme.color.text.secondary}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
