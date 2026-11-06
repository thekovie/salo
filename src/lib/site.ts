/** Product copy used by metadata, link previews and the manifest. One place, so every surface says the same thing. */
export const SITE = {
  name: "Salo",
  tagline: "One table. Everyone’s order.",
  description: "Collect your table's order in one place. Everyone adds their dishes, Salo counts them, the waiter gets one clear ticket. No app, no sign-up.",
  locale: "en_PH",
} as const;

/** Hex twins of the design tokens, for places CSS variables cannot reach (OG images, manifest, theme-color). */
export const BRAND_HEX = {
  paper: "#f8f3ea",
  ticket: "#fffdf8",
  ink: "#262b45",
  inkSoft: "#5a5f78",
  tomato: "#b8392a",
  onTomato: "#fffcf5",
  saffron: "#f1b83c",
  canary: "#fbf3b8",
  darkPaper: "#1f1b18",
} as const;
