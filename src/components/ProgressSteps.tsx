import { View } from 'react-native';
import { useTheme } from '../theme';

export function ProgressSteps({ step, total }: { step: number; total: number }) {
  const theme = useTheme();
  return (
    <View accessibilityLabel={`Étape ${step} sur ${total}`} style={{ flexDirection: 'row', gap: theme.space[1] }}>
      {Array.from({ length: total }, (_, index) => (
        <View
          key={index}
          style={{
            flex: 1,
            height: 4,
            borderRadius: theme.radius.full,
            backgroundColor: index < step ? theme.color.accent.default : theme.color.border.default,
          }}
        />
      ))}
    </View>
  );
}
