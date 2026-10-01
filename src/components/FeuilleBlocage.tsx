import { useState } from 'react';
import { View } from 'react-native';
import { formatTime } from '../domain';
import { useTheme } from '../theme';
import { BottomSheet } from './BottomSheet';
import { Button } from './Button';
import { Chip } from './Chip';
import { Input } from './Input';
import { Text } from './Text';

type Props = {
  visible: boolean;
  openMinute: number;
  closeMinute: number;
  onClose: () => void;
  onConfirm: (input: { startMinute: number; endMinute: number; reason: string }) => void;
  loading?: boolean;
  error?: string | null;
};

export function FeuilleBlocage({ visible, openMinute, closeMinute, onClose, onConfirm, loading, error }: Props) {
  const theme = useTheme();
  const [start, setStart] = useState(18 * 60 + 30);
  const [end, setEnd] = useState(19 * 60);
  const [reason, setReason] = useState('');
  const marks: number[] = [];
  for (let minute = openMinute; minute <= closeMinute; minute += 30) {
    marks.push(minute);
  }
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Bloquer un créneau">
      <Text variant="body-sm" color={theme.color.text.secondary}>
        Le créneau disparaît de la réservation en ligne. Un rendez-vous déjà pris ne peut pas être écrasé.
      </Text>
      <Text variant="label-sm">Début</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
        {marks.slice(0, -1).map((minute) => (
          <Chip key={minute} label={formatTime(minute)} selected={start === minute} onPress={() => setStart(minute)} />
        ))}
      </View>
      <Text variant="label-sm">Fin</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
        {marks.filter((minute) => minute > start).map((minute) => (
          <Chip key={minute} label={formatTime(minute)} selected={end === minute} onPress={() => setEnd(minute)} />
        ))}
      </View>
      <Input label="Raison" value={reason} onChangeText={setReason} placeholder="Pause, formation, privé…" />
      {error ? (
        <Text variant="body-sm" color={theme.color.error.onSubtle} style={{ backgroundColor: theme.color.error.subtle, padding: theme.space[3], borderRadius: theme.radius.md, overflow: 'hidden' }}>
          {error}
        </Text>
      ) : null}
      <Button
        label="Bloquer"
        loading={loading}
        fullWidth
        onPress={() => onConfirm({ startMinute: start, endMinute: end, reason })}
      />
    </BottomSheet>
  );
}
