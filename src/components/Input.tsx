import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { useTheme } from '../theme';
import { Text } from './Text';

type Props = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  error?: string;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address' | 'phone-pad';
  autoCapitalize?: 'none' | 'words' | 'sentences';
  disabled?: boolean;
};

export function Input({
  label,
  value,
  onChangeText,
  placeholder,
  error,
  secureTextEntry,
  keyboardType = 'default',
  autoCapitalize = 'sentences',
  disabled = false,
}: Props) {
  const theme = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ gap: theme.space[2] }}>
      <Text variant="label-sm" color={theme.color.text.secondary}>
        {label}
      </Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.color.text.muted}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        editable={!disabled}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          minHeight: theme.controlHeight.md,
          borderRadius: theme.radius.md,
          paddingHorizontal: theme.space[4],
          backgroundColor: disabled ? theme.color.bg.sunken : theme.color.bg.elevated,
          color: disabled ? theme.color.text.muted : theme.color.text.primary,
          borderWidth: focused ? 2 : 1,
          borderColor: error ? theme.color.error.default : focused ? theme.color.focus.ring : theme.color.border.default,
          fontFamily: theme.font.family.body,
          fontSize: theme.typography.body.md.fontSize,
        }}
      />
      {error ? (
        <Text variant="caption" color={theme.color.error.default}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
