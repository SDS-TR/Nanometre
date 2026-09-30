import { Pressable } from 'react-native';
import { useTheme } from '../theme';
import { Text } from './Text';

type Props = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
};

export function Chip({ label, selected = false, onPress, disabled = false }: Props) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: theme.touchTarget.min,
        paddingHorizontal: theme.space[3],
        borderRadius: theme.radius.full,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: selected ? theme.color.accent.subtle : pressed ? theme.color.bg.sunken : theme.color.bg.elevated,
        borderWidth: 1,
        borderColor: selected ? theme.color.accent.default : theme.color.border.default,
      })}
    >
      <Text variant="label-sm" color={selected ? theme.color.accent.onSubtle : theme.color.text.primary}>
        {label}
      </Text>
    </Pressable>
  );
}
