import type { ReactNode } from 'react';
import { View } from 'react-native';
import { formatTimeRange } from '../domain';
import type { AgendaEntry } from '../data/types';
import { useTheme } from '../theme';
import { Badge } from './Badge';
import { Text } from './Text';

const statusLabel: Record<string, string> = {
  confirme: 'Confirmé',
  honore: 'Honoré',
  en_attente_paiement: 'En attente',
};

export function BlocRendezVous({ entry, children }: { entry: AgendaEntry; children?: ReactNode }) {
  const theme = useTheme();
  const blocked = entry.kind === 'block';
  return (
    <View
      style={{
        backgroundColor: theme.color.bg.elevated,
        borderRadius: theme.radius.lg,
        borderWidth: 1,
        borderColor: blocked ? theme.color.warning.default : theme.color.border.default,
        padding: theme.space[4],
        gap: theme.space[2],
      }}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.space[3] }}>
        <Text variant="label-md">{formatTimeRange(entry.startMinute, entry.endMinute)}</Text>
        {entry.status ? <Badge label={statusLabel[entry.status] ?? entry.status} tone={entry.status === 'honore' ? 'success' : 'accent'} /> : null}
        {blocked ? <Badge label="Bloqué" tone="warning" /> : null}
      </View>
      <Text variant="heading-sm">{entry.title}</Text>
      <Text variant="body-sm" color={theme.color.text.secondary}>
        {entry.subtitle}
        {entry.kind === 'booking' ? ` · ${entry.barberName}` : ''}
      </Text>
      {entry.priceLabel ? (
        <Text variant="label-md" color={theme.color.accent.default}>
          {entry.priceLabel}
        </Text>
      ) : null}
      {children}
    </View>
  );
}
