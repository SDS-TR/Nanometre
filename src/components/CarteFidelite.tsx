import { View } from 'react-native';
import { cutsUntilReward } from '../domain';
import { useTheme } from '../theme';
import type { LoyaltyView } from '../data/types';
import { Text } from './Text';

export function CarteFidelite({ loyalty }: { loyalty: LoyaltyView }) {
  const theme = useTheme();
  const remaining = cutsUntilReward(loyalty.stamps);
  const message =
    loyalty.rewardsAvailable > 0
      ? 'Une coupe offerte t’attend. Tu pourras l’utiliser au paiement.'
      : `Encore ${remaining} coupe${remaining > 1 ? 's' : ''} avant une coupe offerte.`;
  return (
    <View
      style={{
        backgroundColor: theme.color.accent.subtle,
        borderRadius: theme.radius.xl,
        padding: theme.space[5],
        gap: theme.space[4],
      }}
    >
      <Text variant="overline" color={theme.color.accent.onSubtle}>
        Carte de fidélité
      </Text>
      <Text variant="display-lg" color={theme.color.text.primary}>
        {loyalty.points}
      </Text>
      <Text variant="body-sm" color={theme.color.text.secondary}>
        points · 1 point par dollar avant taxes
      </Text>
      <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
        {Array.from({ length: loyalty.cutsPerReward }, (_, index) => {
          const filled = index < loyalty.stamps;
          return (
            <View
              key={index}
              style={{
                flex: 1,
                height: 10,
                borderRadius: theme.radius.full,
                backgroundColor: filled ? theme.color.accent.default : theme.color.bg.elevated,
              }}
            />
          );
        })}
      </View>
      <Text variant="label-md">
        {loyalty.stamps} / {loyalty.cutsPerReward} coupes
      </Text>
      <Text variant="body-sm" color={theme.color.text.secondary}>
        {message}
      </Text>
    </View>
  );
}
