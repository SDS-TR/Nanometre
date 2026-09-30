import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';

type Props = {
  children: ReactNode;
  footer?: ReactNode;
  scroll?: boolean;
};

export function Screen({ children, footer, scroll = true }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: theme.color.bg.default }}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={{ paddingBottom: footer ? theme.space[4] : insets.bottom + theme.space[6] }}
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>{children}</View>
      )}
      {footer ? (
        <View
          style={{
            paddingHorizontal: theme.space[4],
            paddingTop: theme.space[3],
            paddingBottom: Math.max(insets.bottom, theme.space[4]),
            borderTopWidth: 1,
            borderTopColor: theme.color.border.default,
            backgroundColor: theme.color.bg.elevated,
            gap: theme.space[2],
          }}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
}
