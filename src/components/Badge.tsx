import { View } from 'react-native';
import { useTheme } from '../theme';
import { Text } from './Text';

type Tone = 'neutral' | 'success' | 'warning' | 'error' | 'info' | 'accent';

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  const theme = useTheme();
  const palette = {
    neutral: { bg: theme.color.border.default, fg: theme.color.text.secondary },
    success: { bg: theme.color.success.subtle, fg: theme.color.success.onSubtle },
    warning: { bg: theme.color.warning.subtle, fg: theme.color.warning.onSubtle },
    error: { bg: theme.color.error.subtle, fg: theme.color.error.onSubtle },
    info: { bg: theme.color.info.subtle, fg: theme.color.info.onSubtle },
    accent: { bg: theme.color.accent.subtle, fg: theme.color.accent.onSubtle },
  }[tone];
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: palette.bg,
        borderRadius: theme.radius.full,
        paddingHorizontal: theme.space[2],
        paddingVertical: theme.space[1],
        minHeight: 24,
        justifyContent: 'center',
      }}
    >
      <Text variant="label-sm" color={palette.fg}>
        {label}
      </Text>
    </View>
  );
}
