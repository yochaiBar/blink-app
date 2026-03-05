export default {
  light: {
    text: "#000",
    background: "#fff",
    tint: "#FF6347",
    tabIconDefault: "#ccc",
    tabIconSelected: "#FF6347",
  },
};

export const theme = {
  // Backgrounds — warmer dark tones with glassmorphism support
  bg: '#0C0B10',
  bgCard: 'rgba(22, 20, 30, 0.65)',
  bgCardSolid: '#16141E',
  bgCardHover: '#1C1C2A',
  bgElevated: '#1E1C28',
  bgInput: '#13111B',
  surface: '#1A1826',
  surfaceLight: '#252335',

  // Borders — warmer
  border: '#2A283A',
  borderLight: '#35334A',

  // Text
  text: '#FAFAFA',
  textSecondary: '#9B99AA',
  textMuted: '#7A788E',
  textInverse: '#0C0B10',

  // Primary accent — coral
  coral: '#FF6B4A',
  coralLight: '#FF8A6E',
  coralDark: '#E55535',
  coralMuted: 'rgba(255, 107, 74, 0.15)',

  // Accent colors
  yellow: '#FFD84D',
  yellowMuted: 'rgba(255, 216, 77, 0.15)',

  green: '#4ADE80',
  greenMuted: 'rgba(74, 222, 128, 0.15)',

  blue: '#60A5FA',
  blueMuted: 'rgba(96, 165, 250, 0.15)',

  purple: '#A78BFA',
  purpleMuted: 'rgba(167, 139, 250, 0.15)',

  pink: '#F472B6',
  pinkMuted: 'rgba(244, 114, 182, 0.15)',

  red: '#EF4444',
  redMuted: 'rgba(239, 68, 68, 0.15)',

  white: '#FFFFFF',
  black: '#000000',

  // Semantic colors
  success: '#4ADE80',
  successMuted: 'rgba(74, 222, 128, 0.15)',
  warning: '#FBBF24',
  warningMuted: 'rgba(251, 191, 36, 0.15)',
  error: '#EF4444',
  errorMuted: 'rgba(239, 68, 68, 0.15)',
  info: '#60A5FA',
  infoMuted: 'rgba(96, 165, 250, 0.15)',

  // Glassmorphism specific
  glassBorder: 'rgba(255, 255, 255, 0.08)',
  glassHighlight: 'rgba(255, 255, 255, 0.04)',

  categoryColors: {
    close_friends: '#FF6B4A',
    friends: '#FF6B4A',
    family: '#FFD84D',
    students: '#60A5FA',
    work: '#4ADE80',
    custom: '#A78BFA',
  } as Record<string, string>,
} as const;
