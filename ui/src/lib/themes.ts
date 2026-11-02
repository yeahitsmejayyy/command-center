/**
 * The board's colour modes.
 *
 * Each one is a `data-theme` value on the root element and a block of semantic
 * aliases in the stylesheets. Components never name a theme — they read the
 * aliases — so adding one here and a block there is the whole of it.
 *
 * Day and Night come from the Claude design export and live in `tokens.css`.
 * Cyberpunk and Neo do not: they are board-local, and live in `themes.css`
 * so the export stays a transcription of the export.
 */

export type Theme = "light" | "dark" | "cyberpunk" | "neo";

export interface ThemeSpec {
  id: Theme;
  /** What the picker calls it. */
  label: string;
  /** One line under the label, saying what it is for. */
  hint: string;
  /**
   * Two colours shown as a swatch, chosen to read at 14px: the theme's
   * background and the accent it uses most. Literal hex rather than a token,
   * because every swatch is drawn while a different theme is active.
   */
  swatch: [string, string];
}

/** Picker order: the two real themes first, then the two for fun. */
export const THEMES: readonly ThemeSpec[] = [
  { id: "light", label: "Day", hint: "The default", swatch: ["#F2F2F2", "#FF6100"] },
  { id: "dark", label: "Night", hint: "Hand-tuned, not inverted", swatch: ["#0A0A0A", "#FF6100"] },
  // --border-2, not --bg. Cyberpunk's --bg is #050B16, which at swatch size is
  // indistinguishable from Neo's pure black — two themes, one dot. The blue a
  // user actually sees is the borders, wells and cards layered over it, so the
  // swatch shows that instead. The accent is the real --primary.
  { id: "cyberpunk", label: "Cyberpunk", hint: "Neon blue on deep navy", swatch: ["#2B4A7A", "#00E5FF"] },
  { id: "neo", label: "Neo", hint: "Black and grey, with rain", swatch: ["#000000", "#00FF41"] },
] as const;

/**
 * A stored or supplied value, if it is a theme we still ship.
 *
 * Returns undefined rather than a default so the caller decides what an
 * unknown value means. For `cc-theme` in localStorage that matters: a value
 * written by an older build — or by a theme we later dropped — should fall
 * back to the system preference, not to an arbitrary theme.
 */
export function parseTheme(value: unknown): Theme | undefined {
  return THEMES.find((t) => t.id === value)?.id;
}

/** Whether this theme draws the Matrix rain behind the board. */
export function hasRain(theme: Theme): boolean {
  return theme === "neo";
}
