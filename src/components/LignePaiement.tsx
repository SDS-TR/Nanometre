import { Pressable, View } from 'react-native';
import { formatCad, formatLongDate } from '../domain';
import type { PaymentLine } from '../data/types';
import { useTheme } from '../theme';
import { Badge } from './Badge';
import { Text } from './Text';

const payStatus: Record<string, { label: string; tone: 'success' | 'warning' | 'error' | 'neutral' | 'info' }> = {
  paye: { label: 'Payé', tone: 'success' },
  a_encaisser: { label: 'À encaisser', tone: 'warning' },
  rembourse: { label: 'Remboursé', tone: 'info' },
  rembourse_partiel: { label: 'Partiel', tone: 'warning' },
  en_attente: { label: 'En attente', tone: 'neutral' },
  echoue: { label: 'Échoué', tone: 'error' },
};

export function LignePaiement({ line, onPress }: { line: PaymentLine; onPress?: () => void }) {
  const theme = useTheme();
  const status = payStatus[line.status] ?? { label: line.status, tone: 'neutral' as const };
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        paddingVertical: theme.space[3],
        opacity: pressed ? 0.75 : 1,
        borderBottomWidth: 1,
        borderBottomColor: theme.color.border.default,
        gap: theme.space[1],
      })}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.space[3] }}>
        <Text variant="label-md" style={{ flex: 1 }}>
          {line.clientName}
        </Text>
        <Text variant="label-md">{formatCad(line.amountCents)}</Text>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: theme.space[2] }}>
        <Text variant="body-sm" color={theme.color.text.secondary} style={{ flex: 1 }}>
          {formatLongDate(line.date)} · {line.label}
        </Text>
        <Badge label={line.feeRefunded ? 'Frais remboursés' : status.label} tone={line.feeRefunded ? 'info' : status.tone} />
      </View>
    </Pressable>
  );
}
