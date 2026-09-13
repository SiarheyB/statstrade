"use client";

import { Sun, Moon } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import { useI18n } from "@/lib/i18n/provider";

// compact — только иконка (для тесных нав-баров, как у LocaleMenu в
// PublicShell); по умолчанию рядом с иконкой подписано текущее значение
// (страница настроек, где это ряд из иконки+текста, как у LocaleMenu).
export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  const { t } = useI18n();
  const dark = theme === "dark";

  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      className={`inline-flex items-center gap-2 rounded-lg border border-border bg-surface hover:border-border-strong transition ${compact ? "p-2" : "px-3 py-1.5 text-sm"}`}
      title={dark ? t("theme.switchToLight") : t("theme.switchToDark")}
      aria-pressed={!dark}
    >
      {dark ? <Moon size={15} className="text-accent" /> : <Sun size={15} className="text-accent" />}
      {!compact && <span>{dark ? t("theme.dark") : t("theme.light")}</span>}
    </button>
  );
}
