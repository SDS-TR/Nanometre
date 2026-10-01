import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
} from '@expo-google-fonts/inter';
import { PlayfairDisplay_600SemiBold } from '@expo-google-fonts/playfair-display';
import { ToastProvider } from '../src/components/Toast';
import { SCREEN_MS } from '../src/motion';
import { AppStateProvider } from '../src/providers/AppState';
import { AppStripe } from '../src/providers/AppStripe';
import { BookingDraftProvider } from '../src/providers/BookingDraft';
import { useTheme } from '../src/theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const [loaded] = useFonts({
    PlayfairDisplay_600SemiBold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });
  useEffect(() => {
    if (loaded) {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [loaded]);
  if (!loaded) {
    return null;
  }
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppStripe>
          <AppStateProvider>
            <BookingDraftProvider>
              <ToastProvider>
                <RootStack />
              </ToastProvider>
            </BookingDraftProvider>
          </AppStateProvider>
        </AppStripe>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootStack() {
  const theme = useTheme();
  return (
    <>
      <StatusBar style={theme.mode === 'sombre' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          animationDuration: SCREEN_MS,
          contentStyle: { backgroundColor: theme.color.bg.default },
        }}
      />
    </>
  );
}
