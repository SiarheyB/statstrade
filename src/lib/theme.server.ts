import { cookies } from "next/headers";
import { DEFAULT_THEME, isTheme, THEME_COOKIE, type Theme } from "./theme";

// Читает активную тему из cookie (серверные компоненты) — используется в
// layout.tsx, чтобы <html data-theme> совпадал с тем, что уйдёт в разметку, и
// не было мигания темы при первой отрисовке.
export async function getTheme(): Promise<Theme> {
  const store = await cookies();
  const v = store.get(THEME_COOKIE)?.value;
  return isTheme(v) ? v : DEFAULT_THEME;
}
