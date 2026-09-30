import { useEffect } from 'react';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useTheme } from '../theme';

type Props = {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
};

export function Skeleton({ width = '100%', height = 16, radius }: Props) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const opacity = useSharedValue(0.45);
  useEffect(() => {
    opacity.value = reduced ? 0.7 : withRepeat(withTiming(1, { duration: 800 }), -1, true);
  }, [opacity, reduced]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: radius ?? theme.radius.sm,
          backgroundColor: theme.color.border.default,
        },
        animated,
      ]}
    />
  );
}
