import type { ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';
import Animated, { SlideInDown, useReducedMotion } from 'react-native-reanimated';
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
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          accessibilityLabel="Fermer"
          onPress={onClose}
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: theme.color.bg.overlay }}
        />
        <Animated.View
          entering={reduced ? undefined : SlideInDown.springify().mass(SPRING.mass).stiffness(SPRING.stiffness).damping(SPRING.damping)}
          style={{
            backgroundColor: theme.color.bg.elevated,
            borderTopLeftRadius: theme.radius.xl,
            borderTopRightRadius: theme.radius.xl,
            padding: theme.space[4],
            paddingBottom: theme.space[8],
            gap: theme.space[4],
            ...theme.shadow.lg,
          }}
        >
          <View style={{ alignSelf: 'center', width: 40, height: 4, borderRadius: theme.radius.full, backgroundColor: theme.color.border.strong }} />
          {title ? <Text variant="heading-md">{title}</Text> : null}
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}
