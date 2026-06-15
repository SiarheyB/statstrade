// Selectable visual themes. Applied via a `data-theme` attribute on <html>
// (see globals.css). Persisted in a cookie so SSR renders the right palette.

export type ThemeId = "midnight" | "terminal" | "bull" | "bear";

export const DEFAULT_THEME: ThemeId = "midnight";
export const THEME_COOKIE = "ts_theme";

export const THEMES: {
  id: ThemeId;
  name: string;
  desc: string;
  swatch: string;
  bg: string;
}[] = [
  { id: "midnight", name: "Полночь", desc: "Тёмно-синяя", swatch: "#3b82f6", bg: "#0b0e13" },
  { id: "terminal", name: "Терминал", desc: "Зелёный терминал", swatch: "#22c55e", bg: "#05080a" },
  { id: "bull", name: "Бычий рынок", desc: "Зелёно-золотая", swatch: "#16c784", bg: "#07110b" },
  { id: "bear", name: "Медвежий рынок", desc: "Багрово-фиолетовая", swatch: "#f43f5e", bg: "#0e0810" },
];

export function isThemeId(v: string | undefined | null): v is ThemeId {
  return !!v && THEMES.some((t) => t.id === v);
}
