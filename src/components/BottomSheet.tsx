import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { SlideInDown, runOnJS, useReducedMotion } from 'react-native-reanimated';
import { SPRING } from '../motion';
import { useTheme } from '../theme';
import { Text } from './Text';

type Props = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
};

export function BottomSheet({ visible, onClose, title, children }: Props) {
  const theme = useTheme();
  const reduced = useReducedMotion();
  const { height } = useWindowDimensions();
  const dismiss = Gesture.Pan().onEnd((event) => {
    if (event.translationY > 72) {
      runOnJS(onClose)();
    }
  });
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose} accessibilityViewIsModal>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Fermer"
          onPress={onClose}
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: theme.color.bg.overlay }}
        />
        <GestureDetector gesture={dismiss}>
        <Animated.View
          entering={reduced ? undefined : SlideInDown.springify().mass(SPRING.mass).stiffness(SPRING.stiffness).damping(SPRING.damping)}
          style={{
            backgroundColor: theme.color.bg.elevated,
            borderTopLeftRadius: theme.radius.xl,
            borderTopRightRadius: theme.radius.xl,
            padding: theme.space[4],
            paddingBottom: theme.space[8],
            gap: theme.space[4],
            // Avec un salon ouvert 24 h sur 24, les puces d’heures dépassent l’écran : la feuille défile.
            maxHeight: Math.round(height * 0.9),
            ...theme.shadow.lg,
          }}
        >
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: theme.radius.full, backgroundColor: theme.color.border.strong }} />
          {title ? <Text variant="heading-md">{title}</Text> : null}
          <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: theme.space[4] }} keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
        </Animated.View>
        </GestureDetector>
      </KeyboardAvoidingView>
    </Modal>
  );
}
