import { useState } from 'react';
import { ActivityIndicator, Pressable, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { PRESS_MS } from '../motion';
import { useTheme } from '../theme';
import { Text } from './Text';

type Variant = 'primary' | 'secondary' | 'destructive' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

type Props = {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  fullWidth = false,
  style,
}: Props) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const [pressed, setPressed] = useState(false);
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const height = theme.controlHeight[size];
  const blocked = disabled || loading;

  const background =
    variant === 'primary'
      ? pressed
        ? theme.color.accent.pressed
        : theme.color.accent.default
      : variant === 'destructive'
        ? pressed
          ? theme.color.error.pressed
          : theme.color.error.default
        : variant === 'secondary'
          ? pressed
            ? theme.color.accent.subtle
            : 'transparent'
          : 'transparent';
  const foreground =
    variant === 'primary' || variant === 'destructive'
      ? theme.color.text.onAccent
      : variant === 'ghost'
        ? theme.color.accent.default
        : theme.color.text.primary;
  const borderColor = variant === 'secondary' ? theme.color.border.strong : 'transparent';

  return (
    <Animated.View style={[animated, fullWidth ? { alignSelf: 'stretch' } : null, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: blocked }}
        disabled={blocked}
        onPress={onPress}
        onPressIn={() => {
          setPressed(true);
          // Valeur partagée Reanimated : l’écriture est le contrat de l’animation.
          // eslint-disable-next-line react-hooks/immutability
          scale.value = withTiming(reduced ? 1 : 0.98, { duration: reduced ? 0 : PRESS_MS });
        }}
        onPressOut={() => {
          setPressed(false);
          // eslint-disable-next-line react-hooks/immutability
          scale.value = withTiming(1, { duration: reduced ? 0 : PRESS_MS });
        }}
        style={{
          minHeight: height,
          minWidth: theme.touchTarget.min,
          paddingHorizontal: theme.space[4],
          borderRadius: theme.radius.md,
          backgroundColor: blocked ? theme.color.border.default : background,
          borderWidth: variant === 'secondary' ? 1 : 0,
          borderColor,
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'row',
          gap: theme.space[2],
        }}
      >
        {loading ? <ActivityIndicator color={blocked ? theme.color.text.muted : foreground} /> : null}
        <Text variant="label-md" color={blocked ? theme.color.text.muted : foreground} maxFontSizeMultiplier={1.3}>
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}
