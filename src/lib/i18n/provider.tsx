"use client";

import { createContext, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { translate, type Locale, LOCALE_COOKIE } from "./core";
import { setFormatLocale } from "@/lib/format";

type T = (key: string, vars?: Record<string, string | number>) => string;

type Ctx = { locale: Locale; t: T; setLocale: (l: Locale) => void };

const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({
  locale: initial,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const [locale, setLoc] = useState<Locale>(initial);
  const router = useRouter();

  // Keep number/date formatting in sync with the active locale.
  setFormatLocale(locale);

  const t: T = (key, vars) => translate(locale, key, vars);

  const setLocale = (l: Locale) => {
    setLoc(l);
    document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = l;
    router.refresh();
  };

  return (
    <I18nContext.Provider value={{ locale, t, setLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
