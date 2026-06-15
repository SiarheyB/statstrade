"use client";

import { useEffect, useRef, useState } from "react";
import { Languages, Check, ChevronDown } from "lucide-react";
import { LOCALES, type Locale } from "@/lib/i18n/core";
import { useI18n } from "@/lib/i18n/provider";

const FLAG: Record<Locale, string> = { en: "🇬🇧", ru: "🇷🇺" };

export default function LocaleMenu() {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const current = LOCALES.find((l) => l.id === locale) ?? LOCALES[0];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm hover:border-border-strong transition"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t("locale.label")}
      >
        <Languages size={15} className="text-accent" />
        <span aria-hidden>{FLAG[locale]}</span>
        <span>{current.short}</span>
        <ChevronDown size={14} className="text-faint" />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-44 rounded-lg border border-border-strong bg-surface-2 p-1 shadow-2xl">
          {LOCALES.map((l) => (
            <button
              key={l.id}
              onClick={() => {
                setLocale(l.id);
                setOpen(false);
              }}
              className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm hover:bg-surface transition"
            >
              <span aria-hidden className="text-base">{FLAG[l.id]}</span>
              <span className="flex-1">{l.label}</span>
              {l.id === locale && <Check size={15} className="text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
