// i18n core: locale type, cookie, and a pure translate() used on both server
// and client. Dictionaries live in ./dictionaries.
import { dictionaries } from "./dictionaries";

export type Locale = "en" | "ru";

export const LOCALES: { id: Locale; label: string; short: string }[] = [
  { id: "en", label: "English", short: "EN" },
  { id: "ru", label: "Русский", short: "RU" },
];

export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "ts_locale";

export function isLocale(v: string | undefined | null): v is Locale {
  return v === "en" || v === "ru";
}

// Translate a dotted key. Falls back: requested locale -> RU -> key itself.
// Supports {placeholder} interpolation via `vars`.
export function translate(
  locale: Locale,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const table = dictionaries[locale] ?? dictionaries.ru;
  let value = table[key] ?? dictionaries.ru[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      value = value.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return value;
}
