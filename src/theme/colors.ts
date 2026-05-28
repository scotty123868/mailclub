export const colors = {
 paper: "#F8F1E3",
 paperDark: "#EFE2CC",
 ink: "#17223B",
 mutedInk: "#5E6472",
 postalRed: "#B84A3A",
 postalBlue: "#3C6E8F",
 sage: "#9BAF9B",
 gold: "#D9B46E",
 night: "#111A33",
 line: "#D9C8AC",
 white: "#FFFDF7",
 shadow: "#2B2115",
 // v0.7.0.49: tokens for hex values that were inlined across multiple
 // files (audit found 9+ raw `#9A8D76`, 3+ `#607A55`, etc.). Use these
 // going forward instead of raw hex.
 mutedSand: "#9A8D76", // placeholder / icon tint. was inline in 9 files
 sageDeep: "#637C5E", // sage darker. SecondaryButton text, accents
 received: "#607A55", // "received" green. distinct from sage
 goldDeep: "#A89060", // gold accent / AI highlight
};

/**
 * v0.7.0.49: low-alpha overlays used across the app. The audit found
 * 12+ sheets duplicating `rgba(155,175,155,0.20)` for close-button
 * backgrounds, and 3 different opacities (0.12 / 0.18 / 0.20) used
 * interchangeably for sage tints. Standardizing.
 */
export const overlay = {
 sage06: "rgba(155,175,155,0.06)",
 sage10: "rgba(155,175,155,0.10)",
 sage18: "rgba(155,175,155,0.18)",
 sage20: "rgba(155,175,155,0.20)",
 blue06: "rgba(60,110,143,0.06)",
 blue08: "rgba(60,110,143,0.08)",
 red06: "rgba(184,72,58,0.06)",
 red08: "rgba(184,72,58,0.08)",
 red18: "rgba(184,72,58,0.18)",
 gold12: "rgba(217,180,110,0.12)",
 gold18: "rgba(217,180,110,0.18)",
 gold24: "rgba(217,180,110,0.24)",
};

export const gradients = {
 paper: ["#FFF8E9", colors.paper, "#F3E6D0"] as const,
 night: ["#071529", "#0B2841", colors.night] as const,
 postal: [colors.postalBlue, colors.ink] as const,
};
