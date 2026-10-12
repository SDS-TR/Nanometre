import { Pressable, View } from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { addDaysIso, formatLongDate } from '../domain';
import { useTheme } from '../theme';
import { Text } from './Text';

type Props = { date: string; onChange: (date: string) => void; onToday?: () => void };

export function SelecteurDate({ date, onChange, onToday }: Props) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Jour précédent : ${formatLongDate(addDaysIso(date, -1))}`}
        onPress={() => onChange(addDaysIso(date, -1))}
        style={{ width: theme.touchTarget.min, height: theme.touchTarget.min, alignItems: 'center', justifyContent: 'center' }}
      >
        <ChevronLeft color={theme.color.text.primary} size={22} />
      </Pressable>
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text variant="label-md">{formatLongDate(date)}</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Jour suivant : ${formatLongDate(addDaysIso(date, 1))}`}
        onPress={() => onChange(addDaysIso(date, 1))}
        style={{ width: theme.touchTarget.min, height: theme.touchTarget.min, alignItems: 'center', justifyContent: 'center' }}
      >
        <ChevronRight color={theme.color.text.primary} size={22} />
      </Pressable>
      {onToday ? (
        <Pressable accessibilityRole="button" onPress={onToday} style={{ minHeight: theme.touchTarget.min, justifyContent: 'center', paddingHorizontal: theme.space[2] }}>
          <Text variant="label-sm" color={theme.color.accent.default}>
            Aujourd’hui
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
