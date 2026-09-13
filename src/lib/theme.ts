// Тема оформления: та же схема, что у языка/таймзоны (см. src/lib/i18n/) —
// cookie + провайдер на клиенте, геттер на сервере. Значение хранится в
// cookie как обычная строка "dark"/"light", в БД не пишется (устройство, не
// пользователь — как и язык с таймзоной).
//
// Геттер для серверных компонентов — в theme.server.ts: он тянет
// next/headers, а этот файл импортируется и клиентскими компонентами
// (ThemeProvider/ThemeToggle) — next/headers в клиентском бандле собрать
// нельзя (сборка падает: "This API is only available in Server Components").

export type Theme = "dark" | "light";

export const DEFAULT_THEME: Theme = "dark";
export const THEME_COOKIE = "ts_theme";

export function isTheme(v: string | undefined | null): v is Theme {
  return v === "dark" || v === "light";
}
