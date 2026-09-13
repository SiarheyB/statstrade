"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { THEME_COOKIE, type Theme } from "@/lib/theme";

type Ctx = {
  theme: Theme;
  setTheme: (t: Theme) => void;
};

const ThemeContext = createContext<Ctx | null>(null);

export function ThemeProvider({
  theme: initial,
  children,
}: {
  theme: Theme;
  children: React.ReactNode;
}) {
  const [theme, setThemeState] = useState<Theme>(initial);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    // Применяем сразу, без router.refresh(): это чистое переключение CSS
    // (токены в globals.css), от сервера ничего не зависит — рефреш только
    // мигнул бы страницей вхолостую.
    document.documentElement.dataset.theme = t;
    document.cookie = `${THEME_COOKIE}=${t}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Ctx {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
