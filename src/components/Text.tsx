import { Text as RNText, type TextProps, type TextStyle } from 'react-native';
import { useTheme, type Theme } from '../theme';

export type TextVariant =
  | 'display-xl'
  | 'display-lg'
  | 'heading-lg'
  | 'heading-md'
  | 'heading-sm'
  | 'body-lg'
  | 'body-md'
  | 'body-sm'
  | 'label-md'
  | 'label-sm'
  | 'overline'
  | 'caption';

function styleFor(theme: Theme, variant: TextVariant): TextStyle {
  switch (variant) {
    case 'display-xl':
      return theme.typography.display.xl;
    case 'display-lg':
      return theme.typography.display.lg;
    case 'heading-lg':
      return theme.typography.heading.lg;
    case 'heading-md':
      return theme.typography.heading.md;
    case 'heading-sm':
      return theme.typography.heading.sm;
    case 'body-lg':
      return theme.typography.body.lg;
    case 'body-sm':
      return theme.typography.body.sm;
    case 'label-md':
      return theme.typography.label.md;
    case 'label-sm':
      return theme.typography.label.sm;
    case 'overline':
      return { ...theme.typography.label.overline, textTransform: 'uppercase' };
    case 'caption':
      return theme.typography.caption;
    default:
      return theme.typography.body.md;
  }
}

type Props = TextProps & {
  variant?: TextVariant;
  color?: string;
};

export function Text({ variant = 'body-md', color, style, maxFontSizeMultiplier = 2, ...props }: Props) {
  const theme = useTheme();
  const type = styleFor(theme, variant);
  return (
    <RNText
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[
        {
          color: color ?? theme.color.text.primary,
          fontFamily: type.fontFamily,
          fontSize: type.fontSize,
          lineHeight: type.lineHeight,
          letterSpacing: type.letterSpacing,
          textTransform: type.textTransform,
        },
        style,
      ]}
      {...props}
    />
  );
}
