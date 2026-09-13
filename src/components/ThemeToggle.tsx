"use client";

import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import { useI18n } from "@/lib/i18n/provider";

// compact — только иконка-переключатель (для тесных нав-баров, как у
// LocaleMenu в PublicShell): один клик меняет тему на противоположную, и это
// нормально для быстрого доступа. По умолчанию (настройки) — это ДВЕ кнопки
// «Светлая»/«Тёмная» с явно подсвеченной активной: раньше здесь была одна
// кнопка, показывающая текущее значение — выглядела как ярлык состояния, а
// не как переключатель, и было неясно, что по ней вообще можно кликнуть,
// не говоря о том, как выбрать именно светлую.
export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();
  const dark = theme === "dark";

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => setTheme(dark ? "light" : "dark")}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface p-2 hover:border-border-strong transition"
        title={dark ? t("theme.switchToLight") : t("theme.switchToDark")}
        aria-pressed={!dark}
      >
        {dark ? <Moon size={15} className="text-accent" /> : <Sun size={15} className="text-accent" />}
      </button>
    );
  }

  return (
    <div className="inline-flex items-center rounded-lg border border-border bg-surface p-1 gap-1" role="group">
      <button
        type="button"
        onClick={() => setTheme("light")}
        aria-pressed={!dark}
        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition ${!dark ? "bg-accent text-white" : "text-muted hover:text-fg"}`}
      >
        <Sun size={15} />
        {t("theme.light")}
      </button>
      <button
        type="button"
        onClick={() => setTheme("dark")}
        aria-pressed={dark}
        className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition ${dark ? "bg-accent text-white" : "text-muted hover:text-fg"}`}
      >
        <Moon size={15} />
        {t("theme.dark")}
      </button>
    </div>
  );
}
