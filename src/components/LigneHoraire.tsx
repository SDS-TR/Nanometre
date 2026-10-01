import { Pressable, View } from 'react-native';
import { useTheme } from '../theme';
import { Text } from './Text';

type Props = { time: string; title: string; subtitle?: string; onPress?: () => void };

export function LigneHoraire({ time, title, subtitle, onPress }: Props) {
  const theme = useTheme();
  const body = (
    <View style={{ flexDirection: 'row', gap: theme.space[3], minHeight: theme.touchTarget.min, alignItems: 'center' }}>
      <Text variant="label-sm" color={theme.color.accent.default} style={{ width: 88 }}>
        {time}
      </Text>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label-md">{title}</Text>
        {subtitle ? (
          <Text variant="body-sm" color={theme.color.text.secondary}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
  if (!onPress) {
    return body;
  }
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      {body}
    </Pressable>
  );
}
