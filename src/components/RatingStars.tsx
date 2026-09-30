import { Star } from 'lucide-react-native';
import { View } from 'react-native';
import { formatRating } from '../domain';
import { useTheme } from '../theme';
import { Text } from './Text';

type Props = {
  value: number;
  count?: number;
  size?: number;
};

export function RatingStars({ value, count, size = 14 }: Props) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[1] }}>
      {Array.from({ length: 5 }, (_, index) => {
        const filled = value >= index + 1 - 0.25;
        return (
          <Star
            key={index}
            size={size}
            color={filled ? theme.color.accent.default : theme.color.border.strong}
            fill={filled ? theme.color.accent.default : 'transparent'}
          />
        );
      })}
      <Text variant="label-sm" color={theme.color.text.secondary}>
        {formatRating(value)}
        {count != null ? ` (${count})` : ''}
      </Text>
    </View>
  );
}
