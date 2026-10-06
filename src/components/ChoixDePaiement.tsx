import { CreditCard, Store } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { useTheme } from '../theme';
import type { PaymentMethod } from '../domain';
import { Text } from './Text';

type Props = {
  value: PaymentMethod;
  onChange: (value: PaymentMethod) => void;
  error?: string | null;
};

const options: { value: PaymentMethod; title: string; body: string }[] = [
  { value: 'en_ligne', title: 'Payer en ligne', body: 'Carte, Apple Pay ou Google Pay · via Stripe' },
  { value: 'sur_place', title: 'Payer sur place', body: 'Au fauteuil, le jour du rendez-vous' },
];

export function ChoixDePaiement({ value, onChange, error }: Props) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[3] }}>
      {options.map((option) => {
        const selected = value === option.value;
        const Icon = option.value === 'en_ligne' ? CreditCard : Store;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected, checked: selected }}
            onPress={() => onChange(option.value)}
            style={{
              minHeight: theme.touchTarget.min,
              borderRadius: theme.radius.lg,
              borderWidth: selected ? 2 : 1,
              borderColor: selected ? theme.color.accent.default : theme.color.border.default,
              backgroundColor: selected ? theme.color.accent.subtle : theme.color.bg.elevated,
              padding: theme.space[4],
              flexDirection: 'row',
              gap: theme.space[3],
              alignItems: 'center',
            }}
          >
            <Icon color={selected ? theme.color.accent.default : theme.color.text.secondary} size={22} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="label-md">{option.title}</Text>
              <Text variant="body-sm" color={theme.color.text.secondary}>
                {option.body}
              </Text>
            </View>
          </Pressable>
        );
      })}
      {error ? (
        <Text variant="body-sm" color={theme.color.error.default}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
