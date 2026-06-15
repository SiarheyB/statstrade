"use client";

import { useEffect, useRef, useState } from "react";
import { Palette, Check, ChevronDown } from "lucide-react";
import { THEMES, THEME_COOKIE, DEFAULT_THEME, type ThemeId } from "@/lib/themes";
import { useI18n } from "@/lib/i18n/provider";

export default function ThemeMenu({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const [theme, setTheme] = useState<ThemeId>(DEFAULT_THEME);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Sync from the attribute the server set on <html>.
  useEffect(() => {
    const t = document.documentElement.dataset.theme as ThemeId | undefined;
    if (t) setTheme(t);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function apply(id: ThemeId) {
    setTheme(id);
    document.documentElement.dataset.theme = id;
    document.cookie = `${THEME_COOKIE}=${id}; path=/; max-age=31536000; samesite=lax`;
    setOpen(false);
  }

  const current = THEMES.find((t) => t.id === theme) ?? THEMES[0];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm hover:border-border-strong transition"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Palette size={15} className="text-accent" />
        {!compact && <span className="text-muted">{t("theme.label")}:</span>}
        <span
          className="inline-block h-3 w-3 rounded-full"
          style={{ background: current.swatch }}
        />
        <span>{t(`theme.${current.id}.name`)}</span>
        <ChevronDown size={14} className="text-faint" />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-56 rounded-lg border border-border-strong bg-surface-2 p-1 shadow-2xl">
          {THEMES.map((th) => (
            <button
              key={th.id}
              onClick={() => apply(th.id)}
              className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm hover:bg-surface transition"
            >
              <span
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border"
                style={{ background: th.bg }}
              >
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: th.swatch }} />
              </span>
              <span className="flex-1">
                <span className="block">{t(`theme.${th.id}.name`)}</span>
                <span className="block text-xs text-faint">{t(`theme.${th.id}.desc`)}</span>
              </span>
              {th.id === theme && <Check size={15} className="text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
