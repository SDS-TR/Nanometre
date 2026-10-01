import type { ReactNode } from 'react';
import { View } from 'react-native';
import type { Review } from '../data/types';
import { useTheme } from '../theme';
import { Badge } from './Badge';
import { RatingStars } from './RatingStars';
import { Text } from './Text';

const reviewStatus = { en_attente: 'En attente', publie: 'Publié', masque: 'Masqué' } as const;

export function CarteAvis({ review, children }: { review: Review; children?: ReactNode }) {
  const theme = useTheme();
  return (
    <View
      style={{
        backgroundColor: theme.color.bg.elevated,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: theme.color.border.default,
        padding: theme.space[4],
        gap: theme.space[2],
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text variant="label-md">{review.clientName}</Text>
        <Badge label={reviewStatus[review.status]} tone={review.status === 'publie' ? 'success' : 'neutral'} />
      </View>
      <RatingStars value={review.stars} />
      <Text variant="body-md">{review.body}</Text>
      <Text variant="caption" color={theme.color.text.muted}>
        {review.serviceName} · {review.date}
      </Text>
      {children}
    </View>
  );
}
