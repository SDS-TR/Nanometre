// theme.ts — Le Nanometre · généré depuis les tokens Figma « Le Nanometre - Design System »
// Mapping : variable Figma `color/bg/default` -> theme.color.bg.default ; `space/4` -> theme.space[4] (=16)
// Polices (Google Fonts via @expo-google-fonts/playfair-display et @expo-google-fonts/inter)
import { useSyncExternalStore } from 'react';
import { PixelRatio, useColorScheme } from 'react-native';

export const palette = {
  neutral: {
    '0': '#FFFFFF',
    '1000': '#0A0A0B',
    '950': '#111113',
    '900': '#19191C',
    '850': '#212125',
    '800': '#2C2C31',
    '700': '#3D3D43',
    '600': '#5A5A61',
    '500': '#7A7A81',
    '400': '#9E9EA5',
  },
  cream: {
    '50': '#FBF8F2',
    '100': '#F5EFE4',
    '200': '#EBE2D3',
    '300': '#DCCFBB',
    '400': '#B8AB95',
    '500': '#8F8472',
    '600': '#6E6456',
    '700': '#564E43',
    '800': '#3F3932',
  },
  copper: {
    '100': '#F6E8D8',
    '200': '#EBCFB0',
    '300': '#DDB282',
    '400': '#CF9860',
    '500': '#B97C45',
    '600': '#99602F',
    '700': '#7E4C25',
    '800': '#5E381B',
    '900': '#3A2414',
    '950': '#261A12',
  },
  green: {
    '100': '#E2F2E7',
    '300': '#9FDDB6',
    '400': '#5FBF86',
    '700': '#1E7042',
    '800': '#145230',
    '950': '#12241A',
  },
  amber: {
    '100': '#FAEFD6',
    '300': '#F0CF86',
    '400': '#E0B04A',
    '700': '#80540A',
    '800': '#5C3C00',
    '950': '#272010',
  },
  red: {
    '100': '#FBE4E1',
    '300': '#F7B2A9',
    '400': '#F07A6E',
    '700': '#B02A20',
    '800': '#7F1A14',
    '950': '#2C1513',
  },
  blue: {
    '100': '#E2ECF8',
    '300': '#A9CBF0',
    '400': '#6FA8E0',
    '700': '#1F5FA8',
    '800': '#143F70',
    '950': '#121E2B',
  },
  black: {
    'alpha-08': 'rgba(0, 0, 0, 0.08)',
    'alpha-12': 'rgba(0, 0, 0, 0.12)',
    'alpha-16': 'rgba(0, 0, 0, 0.16)',
    'alpha-60': 'rgba(0, 0, 0, 0.6)',
    'alpha-72': 'rgba(0, 0, 0, 0.72)',
  },
} as const;

const colorDark = {
  bg: {
    default: palette.neutral['950'],
    elevated: palette.neutral['900'],
    sunken: palette.neutral['1000'],
    overlay: palette.black['alpha-72'],
  },
  text: {
    primary: palette.cream['100'],
    secondary: palette.cream['300'],
    muted: palette.cream['400'],
    onAccent: palette.neutral['950'],
    inverse: palette.neutral['950'],
  },
  accent: {
    default: palette.copper['400'],
    pressed: palette.copper['500'],
    subtle: palette.copper['950'],
    onSubtle: palette.copper['200'],
  },
  border: {
    default: palette.neutral['800'],
    strong: palette.neutral['500'],
  },
  focus: {
    ring: palette.copper['300'],
  },
  success: {
    default: palette.green['400'],
    subtle: palette.green['950'],
    onSubtle: palette.green['300'],
  },
  warning: {
    default: palette.amber['400'],
    subtle: palette.amber['950'],
    onSubtle: palette.amber['300'],
  },
  error: {
    default: palette.red['400'],
    pressed: palette.red['300'],
    subtle: palette.red['950'],
    onSubtle: palette.red['300'],
  },
  info: {
    default: palette.blue['400'],
    subtle: palette.blue['950'],
    onSubtle: palette.blue['300'],
  },
} as const;

const colorLight = {
  bg: {
    default: palette.cream['50'],
    elevated: palette.neutral['0'],
    sunken: palette.cream['100'],
    overlay: palette.black['alpha-60'],
  },
  text: {
    primary: palette.neutral['950'],
    secondary: palette.cream['700'],
    muted: palette.cream['600'],
    onAccent: palette.neutral['0'],
    inverse: palette.cream['100'],
  },
  accent: {
    default: palette.copper['600'],
    pressed: palette.copper['700'],
    subtle: palette.copper['100'],
    onSubtle: palette.copper['800'],
  },
  border: {
    default: palette.cream['200'],
    strong: palette.cream['500'],
  },
  focus: {
    ring: palette.copper['700'],
  },
  success: {
    default: palette.green['700'],
    subtle: palette.green['100'],
    onSubtle: palette.green['800'],
  },
  warning: {
    default: palette.amber['700'],
    subtle: palette.amber['100'],
    onSubtle: palette.amber['800'],
  },
  error: {
    default: palette.red['700'],
    pressed: palette.red['800'],
    subtle: palette.red['100'],
    onSubtle: palette.red['800'],
  },
  info: {
    default: palette.blue['700'],
    subtle: palette.blue['100'],
    onSubtle: palette.blue['800'],
  },
} as const;

export const space = { 0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64, 20: 80, 24: 96 } as const;
export const touchTarget = { min: 44 } as const;
/** Hauteur minimale des contrôles (Button, Input) — variables Figma control-height/sm|md|lg. */
export const controlHeight = { sm: 44, md: 48, lg: 56 } as const;
export const radius = { none: 0, sm: 6, md: 10, lg: 16, xl: 24, full: 999 } as const;
export const font = { family: { display: 'PlayfairDisplay_600SemiBold', body: 'Inter_400Regular', bodyMedium: 'Inter_500Medium', bodySemibold: 'Inter_600SemiBold' } } as const;
export const typography = {
  brand: {
    wordmark: {
      fontFamily: 'PlayfairDisplay_600SemiBold',
      fontWeight: '600',
      fontSize: 88,
      lineHeight: 96,
      letterSpacing: -1.5,
    },
  },
  display: {
    '2xl': {
      fontFamily: 'PlayfairDisplay_600SemiBold',
      fontWeight: '600',
      fontSize: 56,
      lineHeight: 64,
      letterSpacing: -1,
    },
    xl: {
      fontFamily: 'PlayfairDisplay_600SemiBold',
      fontWeight: '600',
      fontSize: 40,
      lineHeight: 48,
      letterSpacing: -0.5,
    },
    lg: {
      fontFamily: 'PlayfairDisplay_600SemiBold',
      fontWeight: '600',
      fontSize: 32,
      lineHeight: 40,
      letterSpacing: -0.25,
    },
  },
  heading: {
    lg: {
      fontFamily: 'PlayfairDisplay_600SemiBold',
      fontWeight: '600',
      fontSize: 26,
      lineHeight: 32,
      letterSpacing: 0,
    },
    md: {
      fontFamily: 'PlayfairDisplay_600SemiBold',
      fontWeight: '600',
      fontSize: 22,
      lineHeight: 28,
      letterSpacing: 0,
    },
    sm: {
      fontFamily: 'Inter_600SemiBold',
      fontWeight: '600',
      fontSize: 18,
      lineHeight: 24,
      letterSpacing: 0,
    },
  },
  body: {
    lg: {
      fontFamily: 'Inter_400Regular',
      fontWeight: '400',
      fontSize: 18,
      lineHeight: 28,
      letterSpacing: 0,
    },
    md: {
      fontFamily: 'Inter_400Regular',
      fontWeight: '400',
      fontSize: 16,
      lineHeight: 24,
      letterSpacing: 0,
    },
    sm: {
      fontFamily: 'Inter_400Regular',
      fontWeight: '400',
      fontSize: 14,
      lineHeight: 20,
      letterSpacing: 0,
    },
  },
  label: {
    md: {
      fontFamily: 'Inter_600SemiBold',
      fontWeight: '600',
      fontSize: 15,
      lineHeight: 20,
      letterSpacing: 0.2,
    },
    sm: {
      fontFamily: 'Inter_500Medium',
      fontWeight: '500',
      fontSize: 13,
      lineHeight: 16,
      letterSpacing: 0.4,
    },
    overline: {
      fontFamily: 'Inter_600SemiBold',
      fontWeight: '600',
      fontSize: 12,
      lineHeight: 16,
      letterSpacing: 2,
    },
  },
  caption: {
    fontFamily: 'Inter_400Regular',
    fontWeight: '400',
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.2,
  },
} as const;

// Ombres légères. En mode sombre, l'élévation passe surtout par color.bg.elevated (les ombres restent quasi invisibles).
export const shadow = {
  sm: { boxShadow: '0 1px 1.5px rgba(0, 0, 0, 0.12)' },
  md: { boxShadow: '0 4px 6px rgba(0, 0, 0, 0.12)' },
  lg: { boxShadow: '0 12px 16px rgba(0, 0, 0, 0.16)' },
} as const;

/** Mise à l'échelle 130 % : garder le ratio line-height/size quand l'utilisateur agrandit le texte. */
export const scaledLineHeight = (fontSize: number, lineHeight: number) =>
  Math.round(lineHeight * Math.min(PixelRatio.getFontScale(), 2));

const base = { space, touchTarget, controlHeight, radius, font, typography, shadow };
export const darkTheme = { mode: 'sombre' as const, color: colorDark, ...base };
export const lightTheme = { mode: 'clair' as const, color: colorLight, ...base };
export type Theme = typeof darkTheme;

export type ThemePreference = 'sombre' | 'clair' | 'systeme';

let themePreference: ThemePreference = 'sombre';
const themeListeners = new Set<() => void>();

export function getThemePreference(): ThemePreference {
  return themePreference;
}

export function setThemePreference(next: ThemePreference): void {
  themePreference = next;
  themeListeners.forEach((listener) => listener());
}

function subscribeTheme(listener: () => void): () => void {
  themeListeners.add(listener);
  return () => themeListeners.delete(listener);
}

/** Mode sombre par défaut ; le clair suit un choix explicite ou, si « système », le réglage de l'appareil. */
export function useTheme(override?: 'sombre' | 'clair'): Theme {
  const scheme = useColorScheme();
  const preference = useSyncExternalStore(subscribeTheme, getThemePreference, getThemePreference);
  const mode =
    override ?? (preference === 'systeme' ? (scheme === 'light' ? 'clair' : 'sombre') : preference);
  return (mode === 'clair' ? lightTheme : darkTheme) as Theme;
}
