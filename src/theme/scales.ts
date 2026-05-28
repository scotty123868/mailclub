/**
 * v0.7.0.49: spacing / radius / shadow scales.
 *
 * The audit found 22 distinct font sizes, 16 borderRadius values, and 8
 * shadowOpacity values scattered across the codebase. These tokens
 * codify the intended scales. NEW code should use them; existing code
 * is left alone unless touched for other reasons. Incremental migration
 * via grep over time.
 *
 * Naming convention: `xs / sm / md / lg / xl / 2xl` keeps the door open
 * for additional steps without renaming.
 */

/** 4pt base grid. Most spacing decisions land on one of these six steps. */
export const spacing = {
 xs: 4,
 sm: 8,
 md: 12,
 lg: 16,
 xl: 24,
 "2xl": 32,
} as const;

/**
 * Border radii. `pill` is the fully-rounded option (capsule shape) for
 * buttons and chips; `xs`-`xl` are the canonical sharp-to-soft scale.
 */
export const radius = {
 xs: 4,
 sm: 6,
 md: 8,
 lg: 12,
 xl: 18,
 pill: 999,
} as const;

/**
 * Elevation presets. Each maps to a React Native shadow + Android
 * elevation pair. Use these directly:
 *
 * <View style={[styles.card, shadow.md]} />
 *
 * Don't override individual shadowOffset/Radius/Opacity values; use
 * one of the named tiers. If you need a new tier, ADD it here. don't
 * sprinkle one-offs.
 */
export const shadow = {
 sm: {
 shadowColor: "#2B2115",
 shadowOffset: { width: 0, height: 1 },
 shadowOpacity: 0.08,
 shadowRadius: 2,
 elevation: 1,
 },
 md: {
 shadowColor: "#2B2115",
 shadowOffset: { width: 0, height: 2 },
 shadowOpacity: 0.12,
 shadowRadius: 6,
 elevation: 3,
 },
 lg: {
 shadowColor: "#2B2115",
 shadowOffset: { width: 0, height: 6 },
 shadowOpacity: 0.18,
 shadowRadius: 14,
 elevation: 6,
 },
 xl: {
 shadowColor: "#2B2115",
 shadowOffset: { width: 0, height: 10 },
 shadowOpacity: 0.24,
 shadowRadius: 22,
 elevation: 10,
 },
} as const;

/**
 * Press scale (used by Pressables that should subtly recede). 0.97
 * universally. the audit found 0.96, 0.97, 0.98, 0.99 used in
 * different places.
 */
export const motion = {
 pressScale: 0.97,
} as const;
