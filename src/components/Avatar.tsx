import { Image } from 'expo-image';
import { View } from 'react-native';
import { photoSource } from '../data/photos';
import { useTheme } from '../theme';
import { Text } from './Text';

const sizes = { sm: 36, md: 48, lg: 72, xl: 96 } as const;

type Props = {
  name: string;
  photo?: string;
  size?: keyof typeof sizes;
};

export function Avatar({ name, photo, size = 'md' }: Props) {
  const theme = useTheme();
  const dimension = sizes[size];
  const initials = name
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
  return (
    <View
      style={{
        width: dimension,
        height: dimension,
        borderRadius: theme.radius.full,
        overflow: 'hidden',
        backgroundColor: theme.color.accent.subtle,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {photo ? (
        <Image source={photoSource(photo)} style={{ width: '100%', height: '100%' }} contentFit="cover" contentPosition="top" />
      ) : (
        <Text variant="label-md" color={theme.color.accent.onSubtle}>
          {initials}
        </Text>
      )}
    </View>
  );
}
