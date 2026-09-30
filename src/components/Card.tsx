import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useTheme } from '../theme';

type Props = {
  children: ReactNode;
  onPress?: () => void;
  padded?: boolean;
};

export function Card({ children, onPress, padded = true }: Props) {
  const theme = useTheme();
  const style = {
    backgroundColor: theme.color.bg.elevated,
    borderRadius: theme.radius.lg,
    padding: padded ? theme.space[4] : 0,
    borderWidth: 1,
    borderColor: theme.color.border.default,
    overflow: 'hidden' as const,
  };
  if (!onPress) {
    return <View style={style}>{children}</View>;
  }
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [style, pressed ? { backgroundColor: theme.color.bg.sunken } : null]}
    >
      {children}
    </Pressable>
  );
}
