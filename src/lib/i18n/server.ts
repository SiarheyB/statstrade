import { cookies } from "next/headers";
import {
  translate,
  isLocale,
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  type Locale,
} from "./core";
import { normalizeTimezone } from "@/lib/timezone";
import { TIMEZONE_COOKIE, type TimezoneId } from "@/lib/timezone";

// Read the active locale from the cookie (server components).
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const v = store.get(LOCALE_COOKIE)?.value;
  return isLocale(v) ? v : DEFAULT_LOCALE;
}

// Read the active display timezone from the cookie (server components).
export async function getTimezone(): Promise<TimezoneId> {
  const store = await cookies();
  const v = store.get(TIMEZONE_COOKIE)?.value;
  return normalizeTimezone(v);
}

// Server-side translator bound to the current cookie locale.
export async function getServerT() {
  const locale = await getLocale();
  return {
    locale,
    t: (key: string, vars?: Record<string, string | number>) =>
      translate(locale, key, vars),
  };
}
