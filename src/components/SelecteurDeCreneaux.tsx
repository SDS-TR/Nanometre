import { ScrollView, View, useWindowDimensions } from 'react-native';
import { formatChipDate, formatTime, formatTimeRange, slotLegend } from '../domain';
import { useTheme } from '../theme';
import type { SlotView } from '../data/types';
import { Chip } from './Chip';
import { Text } from './Text';

type Period = 'tout' | 'matin' | 'apres-midi';

type Props = {
  dates: string[];
  date: string;
  onDate: (date: string) => void;
  period: Period;
  onPeriod: (period: Period) => void;
  slots: SlotView[];
  selectedStart: number | null;
  onSelect: (slot: SlotView) => void;
  closeMinute?: number;
};

export function SelecteurDeCreneaux({ dates, date, onDate, period, onPeriod, slots, selectedStart, onSelect, closeMinute = 19 * 60 }: Props) {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const free = slots.filter((slot) => {
    if (!slot.available) {
      return false;
    }
    if (period === 'matin') {
      return slot.startMinute < 12 * 60;
    }
    if (period === 'apres-midi') {
      return slot.startMinute >= 12 * 60;
    }
    return true;
  });
  const column = Math.floor((width - theme.space[4] * 2 - theme.space[2] * 2) / 3);
  return (
    <View style={{ gap: theme.space[4] }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space[2], paddingHorizontal: theme.space[4] }}>
        {dates.map((item) => (
          <Chip key={item} label={formatChipDate(item)} selected={item === date} onPress={() => onDate(item)} />
        ))}
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: theme.space[2], paddingHorizontal: theme.space[4] }}>
        <Chip label="Tout" selected={period === 'tout'} onPress={() => onPeriod('tout')} />
        <Chip label="Matin" selected={period === 'matin'} onPress={() => onPeriod('matin')} />
        <Chip label="Après-midi" selected={period === 'apres-midi'} onPress={() => onPeriod('apres-midi')} />
      </View>
      {free.length === 0 ? (
        <Text variant="body-md" color={theme.color.text.secondary} style={{ paddingHorizontal: theme.space[4] }}>
          Aucun créneau libre ce jour-là. Essaie une autre date.
        </Text>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2], paddingHorizontal: theme.space[4] }}>
          {free.map((slot) => {
            const selected = slot.startMinute === selectedStart;
            return (
              <Chip
                key={slot.startMinute}
                label={formatTime(slot.startMinute)}
                selected={selected}
                onPress={() => onSelect(slot)}
              />
            );
          })}
        </View>
      )}
      {selectedStart != null ? (
        <Text variant="body-sm" color={theme.color.text.secondary} style={{ paddingHorizontal: theme.space[4] }}>
          {formatTimeRange(selectedStart, free.find((slot) => slot.startMinute === selectedStart)?.endMinute ?? selectedStart)}
        </Text>
      ) : null}
      <Text variant="caption" color={theme.color.text.muted} style={{ paddingHorizontal: theme.space[4] }}>
        {slotLegend(closeMinute)}
      </Text>
      <View style={{ height: 0, width: column }} />
    </View>
  );
}
