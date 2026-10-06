import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { hapticError, hapticSuccess } from '../lib/haptics';
import { useTheme } from '../theme';
import { Text } from './Text';

type Toast = { message: string; tone: 'success' | 'error' | 'info' };

const ToastContext = createContext<(toast: { message: string; tone?: Toast['tone'] }) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<Toast | null>(null);
  const show = useCallback((next: { message: string; tone?: Toast['tone'] }) => {
    const tone = next.tone ?? 'info';
    setToast({ message: next.message, tone });
    AccessibilityInfo.announceForAccessibility(next.message);
    if (tone === 'error') {
      hapticError();
    }
    if (tone === 'success') {
      hapticSuccess();
    }
  }, []);
  useEffect(() => {
    if (!toast) {
      return undefined;
    }
    const timer = setTimeout(() => setToast(null), 3400);
    return () => clearTimeout(timer);
  }, [toast]);
  const toneColor = {
    success: theme.color.success.default,
    error: theme.color.error.default,
    info: theme.color.accent.default,
  }[toast?.tone ?? 'info'];
  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast ? (
        <View
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          style={{
            position: 'absolute',
            left: theme.space[4],
            right: theme.space[4],
            bottom: insets.bottom + 64,
            pointerEvents: 'none',
            backgroundColor: theme.color.bg.elevated,
            borderRadius: theme.radius.md,
            borderLeftWidth: 3,
            borderLeftColor: toneColor,
            padding: theme.space[4],
            ...theme.shadow.md,
          }}
        >
          <Text variant="body-sm">{toast.message}</Text>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
