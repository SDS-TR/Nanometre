import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { formatLongDate } from '../domain';
import { useTheme } from '../theme';
import { Text } from './Text';

type Props = { date: string; onChange: (date: string) => void; onToday?: () => void };

function toDate(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

function toIso(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function SelecteurDate({ date, onChange, onToday }: Props) {
  const theme = useTheme();
  const [open, setOpen] = useState(Platform.OS === 'ios');
  return (
    <View style={{ gap: theme.space[2] }}>
      {Platform.OS === 'android' ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Choisir une autre date. Date choisie : ${formatLongDate(date)}`} onPress={() => setOpen(true)} style={{ minHeight: theme.touchTarget.min, justifyContent: 'center' }}>
          <Text variant="label-md">{formatLongDate(date)}</Text>
        </Pressable>
      ) : null}
      {open ? (
        <DateTimePicker
          value={toDate(date)}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={(_event, value) => {
            if (Platform.OS === 'android') {
              setOpen(false);
            }
            if (value) {
              onChange(toIso(value));
            }
          }}
        />
      ) : null}
      {onToday ? (
        <Pressable accessibilityRole="button" onPress={onToday} style={{ minHeight: theme.touchTarget.min, justifyContent: 'center' }}>
          <Text variant="label-sm" color={theme.color.accent.default}>
            Aujourd’hui
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
