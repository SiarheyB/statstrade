"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { translate, type Locale, LOCALE_COOKIE } from "./core";
import { setFormatLocale, setFormatTimezone } from "@/lib/format";
import { TIMEZONE_COOKIE, type TimezoneId, normalizeTimezone } from "@/lib/timezone";

/** Функция перевода. Экспортируется для компонентов, которым её передают пропсом. */
export type T = (key: string, vars?: Record<string, string | number>) => string;

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

  // Синхронизация модульных переменных lib/format.ts делается ПРЯМО В РЕНДЕРЕ,
  // а не в useEffect, и это намеренно: fmtMoney/fmtDate читают их синхронно
  // во время того же рендера дочерних компонентов. Из эффекта они успели бы
  // отработать только после первого кадра — и первый кадр вышел бы с чужой
  // локалью и таймзоной, включая серверный рендер.
  //
  // Присваивание идемпотентно (одно и то же значение сколько угодно раз даёт
  // тот же результат), поэтому повторный рендер в StrictMode ничего не портит.
  setFormatLocale(locale);
  setFormatTimezone(timezone);

  // t, setLocale, setTimezone и сам объект контекста были новыми на КАЖДОМ
  // рендере провайдера. Он обёрнут вокруг всего кабинета, а объект-литерал в
  // value заставляет перерисоваться каждого потребителя контекста, даже когда
  // ни язык, ни зона не менялись.
  const t = useCallback<T>((key, vars) => translate(locale, key, vars), [locale]);

  const setLocale = useCallback((l: Locale) => {
    setLoc(l);
    document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = l;
    router.refresh();
  }, [router]);

  const setTimezone = useCallback((tz: TimezoneId) => {
    const normalized = normalizeTimezone(tz);
    setTz(normalized);
    document.cookie = `${TIMEZONE_COOKIE}=${normalized}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }, [router]);

  const value = useMemo(
    () => ({ locale, t, setLocale, timezone, setTimezone }),
    [locale, t, setLocale, timezone, setTimezone],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
