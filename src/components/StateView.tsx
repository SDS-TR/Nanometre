import { View } from 'react-native';
import { useTheme } from '../theme';
import { Button } from './Button';
import { Skeleton } from './Skeleton';
import { Text } from './Text';

export function LoadingBlock() {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space[3], padding: theme.space[4] }}>
      <Skeleton height={180} radius={theme.radius.lg} />
      <Skeleton height={24} width="60%" />
      <Skeleton height={88} radius={theme.radius.lg} />
      <Skeleton height={88} radius={theme.radius.lg} />
    </View>
  );
}

export function StateMessage({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const theme = useTheme();
  return (
    <View style={{ padding: theme.space[6], gap: theme.space[3], alignItems: 'flex-start' }}>
      <Text variant="heading-md">{title}</Text>
      <Text variant="body-md" color={theme.color.text.secondary}>
        {body}
      </Text>
      {actionLabel && onAction ? <Button label={actionLabel} onPress={onAction} variant="secondary" /> : null}
    </View>
  );
}
