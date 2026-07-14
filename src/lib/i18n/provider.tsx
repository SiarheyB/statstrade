"use client";

import { createContext, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { translate, type Locale, LOCALE_COOKIE } from "./core";
import { setFormatLocale, setFormatTimezone } from "@/lib/format";
import { TIMEZONE_COOKIE, type TimezoneId, normalizeTimezone } from "@/lib/timezone";

type T = (key: string, vars?: Record<string, string | number>) => string;

type Ctx = {
  locale: Locale;
  t: T;
  setLocale: (l: Locale) => void;
  timezone: TimezoneId;
  setTimezone: (tz: TimezoneId) => void;
};

const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({
  locale: initial,
  timezone: initialTz,
  children,
}: {
  locale: Locale;
  timezone: TimezoneId;
  children: React.ReactNode;
}) {
  const [locale, setLoc] = useState<Locale>(initial);
  const [timezone, setTz] = useState<TimezoneId>(normalizeTimezone(initialTz));
  const router = useRouter();

  // Keep number/date formatting in sync with the active locale/timezone.
  setFormatLocale(locale);
  setFormatTimezone(timezone);

  const t: T = (key, vars) => translate(locale, key, vars);

  const setLocale = (l: Locale) => {
    setLoc(l);
    document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = l;
    router.refresh();
  };

  const setTimezone = (tz: TimezoneId) => {
    const normalized = normalizeTimezone(tz);
    setTz(normalized);
    document.cookie = `${TIMEZONE_COOKIE}=${normalized}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };

  return (
    <I18nContext.Provider value={{ locale, t, setLocale, timezone, setTimezone }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
