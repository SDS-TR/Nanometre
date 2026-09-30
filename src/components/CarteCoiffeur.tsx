import { Pressable, View } from 'react-native';
import { ChevronRight } from 'lucide-react-native';
import { useTheme } from '../theme';
import type { Barber } from '../data/types';
import { Avatar } from './Avatar';
import { RatingStars } from './RatingStars';
import { Text } from './Text';

export function CarteCoiffeur({ barber, onPress }: { barber: Barber; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={barber.fullName}
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: pressed ? theme.color.bg.sunken : theme.color.bg.elevated,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.color.border.default,
        padding: theme.space[3],
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space[3],
        minHeight: 88,
      })}
    >
      <Avatar name={barber.fullName} photo={barber.photo} size="lg" />
      <View style={{ flex: 1, gap: theme.space[1] }}>
        <Text variant="heading-sm">{barber.fullName}</Text>
        <Text variant="body-sm" color={theme.color.text.secondary}>
          {barber.specialty}
        </Text>
        <RatingStars value={barber.rating} count={barber.reviewCount} />
      </View>
      <ChevronRight color={theme.color.text.muted} size={20} />
    </Pressable>
  );
}
