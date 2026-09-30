import { Pressable, View } from 'react-native';
import { useTheme } from '../theme';
import { Text } from './Text';

type Option<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
};

export function SegmentedControl<T extends string>({ options, value, onChange }: Props<T>) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        backgroundColor: theme.color.bg.sunken,
        borderRadius: theme.radius.md,
        padding: theme.space[1],
        gap: theme.space[1],
      }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(option.value)}
            style={{
              flex: 1,
              minHeight: theme.touchTarget.min,
              borderRadius: theme.radius.sm,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: selected ? theme.color.bg.elevated : 'transparent',
              paddingHorizontal: theme.space[2],
            }}
          >
            <Text variant="label-sm" color={selected ? theme.color.text.primary : theme.color.text.muted}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
