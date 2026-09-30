import { Image } from 'expo-image';
import { Pressable, View } from 'react-native';
import { formatCad, formatDuration } from '../domain';
import { photoSource } from '../data/photos';
import { useTheme } from '../theme';
import type { Service } from '../data/types';
import { Text } from './Text';

type Props = {
  service: Service;
  layout?: 'grille' | 'liste';
  selected?: boolean;
  onPress?: () => void;
};

export function CarteCoupe({ service, layout = 'grille', selected = false, onPress }: Props) {
  const theme = useTheme();
  const wide = layout === 'liste';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        width: wide ? '100%' : 220,
        backgroundColor: pressed ? theme.color.bg.sunken : theme.color.bg.elevated,
        borderRadius: theme.radius.lg,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? theme.color.accent.default : theme.color.border.default,
        overflow: 'hidden',
        flexDirection: wide ? 'row' : 'column',
      })}
    >
      <Image
        source={photoSource(service.photo)}
        style={wide ? { width: 104, height: 104 } : { width: '100%', height: 128 }}
        contentFit="cover"
      />
      <View style={{ padding: theme.space[3], gap: theme.space[1], flex: 1, justifyContent: 'center' }}>
        <Text variant="label-md">{service.name}</Text>
        <Text variant="caption" color={theme.color.text.muted}>
          {formatDuration(service.durationMinutes)}
        </Text>
        <Text variant="label-md" color={theme.color.accent.default}>
          {formatCad(service.priceCents)}
        </Text>
      </View>
    </Pressable>
  );
}
