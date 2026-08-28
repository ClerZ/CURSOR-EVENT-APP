export const colors = {
  bg: "#150F2E",
  bg2: "#1A1338",
  surface: "#1E1740",
  surface2: "#271C52",
  line: "rgba(245,242,255,0.09)",
  lineStrong: "rgba(245,242,255,0.16)",
  text: "#F5F2FF",
  muted: "#A79FC9",
  muted2: "#8377A8",
  amber: "#FFB627",
  amberInk: "#3A2A05",
  pink: "#FF4D8D",
  mint: "#3ED9A6",
  violet: "#8C7CF0",
  coral: "#FF7A59",
};

export const categoryColors: Record<string, { bg: string; fg: string }> = {
  Word: { bg: "rgba(255,182,39,0.16)", fg: colors.amber },
  Drawing: { bg: "rgba(255,77,141,0.16)", fg: colors.pink },
  Arcade: { bg: "rgba(62,217,166,0.16)", fg: colors.mint },
  Puzzle: { bg: "rgba(140,124,240,0.18)", fg: colors.violet },
  Strategy: { bg: "rgba(255,122,89,0.18)", fg: colors.coral },
};
