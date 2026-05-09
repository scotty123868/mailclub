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
};

export const gradients = {
  paper: ["#FFF8E9", colors.paper, "#F3E6D0"] as const,
  night: ["#071529", "#0B2841", colors.night] as const,
  postal: [colors.postalBlue, colors.ink] as const,
};
