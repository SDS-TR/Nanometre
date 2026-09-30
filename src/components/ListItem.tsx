import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '../theme';
import { Text } from './Text';

type Props = {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  onPress?: () => void;
  selected?: boolean;
};

export function ListItem({ title, subtitle, leading, trailing, onPress, selected = false }: Props) {
  const theme = useTheme();
  const content = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], minHeight: theme.touchTarget.min }}>
      {leading}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="label-md">{title}</Text>
        {subtitle ? (
          <Text variant="body-sm" color={theme.color.text.secondary}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </View>
  );
  if (!onPress) {
    return <View style={{ paddingVertical: theme.space[2] }}>{content}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        paddingVertical: theme.space[2],
        paddingHorizontal: theme.space[2],
        borderRadius: theme.radius.md,
        backgroundColor: selected ? theme.color.accent.subtle : pressed ? theme.color.bg.sunken : 'transparent',
      })}
    >
      {content}
    </Pressable>
  );
}
