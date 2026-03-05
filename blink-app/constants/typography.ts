export const typography = {
  // Legacy aliases — kept for backward compatibility during migration
  h1: { fontSize: 28, fontWeight: '800' as const, lineHeight: 34 },
  h2: { fontSize: 22, fontWeight: '800' as const, lineHeight: 28 },
  h3: { fontSize: 18, fontWeight: '700' as const, lineHeight: 24 },
  h4: { fontSize: 16, fontWeight: '700' as const, lineHeight: 22 },
  body: { fontSize: 15, fontWeight: '400' as const, lineHeight: 21 },
  bodyBold: { fontSize: 15, fontWeight: '600' as const, lineHeight: 21 },
  caption: { fontSize: 13, fontWeight: '400' as const, lineHeight: 18 },
  label: { fontSize: 12, fontWeight: '600' as const, lineHeight: 16, letterSpacing: 0.5 },
  small: { fontSize: 11, fontWeight: '400' as const, lineHeight: 15 },

  // Display — hero titles, challenge prompts
  displayLarge: {
    fontSize: 34,
    fontWeight: '800' as const,
    letterSpacing: -1,
    lineHeight: 40,
  },
  displayMedium: {
    fontSize: 28,
    fontWeight: '800' as const,
    letterSpacing: -0.5,
    lineHeight: 34,
  },

  // Headlines — section titles
  headlineLarge: {
    fontSize: 22,
    fontWeight: '700' as const,
    letterSpacing: -0.3,
    lineHeight: 28,
  },
  headlineMedium: {
    fontSize: 18,
    fontWeight: '700' as const,
    letterSpacing: 0,
    lineHeight: 24,
  },

  // Body
  bodyLarge: {
    fontSize: 16,
    fontWeight: '400' as const,
    lineHeight: 22,
  },
  bodyMedium: {
    fontSize: 14,
    fontWeight: '400' as const,
    lineHeight: 20,
  },
  bodySmall: {
    fontSize: 12,
    fontWeight: '400' as const,
    lineHeight: 16,
  },

  // Labels
  labelLarge: {
    fontSize: 14,
    fontWeight: '600' as const,
    letterSpacing: 0.3,
    lineHeight: 20,
  },
  labelSmall: {
    fontSize: 11,
    fontWeight: '600' as const,
    letterSpacing: 0.5,
    lineHeight: 16,
    textTransform: 'uppercase' as const,
  },

  // Accent — numbers, stats, streaks
  statLarge: {
    fontSize: 32,
    fontWeight: '800' as const,
    letterSpacing: -1,
  },
  statMedium: {
    fontSize: 20,
    fontWeight: '700' as const,
    letterSpacing: -0.5,
  },
} as const;
