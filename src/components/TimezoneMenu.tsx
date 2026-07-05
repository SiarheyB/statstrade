"use client";

import { useEffect, useRef, useState } from "react";
import { Clock, Check, ChevronDown } from "lucide-react";
import { TIMEZONES } from "@/lib/timezone";
import { useI18n } from "@/lib/i18n/provider";

export default function TimezoneMenu() {
  const { timezone, setTimezone, t } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = TIMEZONES.find((tz) => tz.id === timezone) ?? TIMEZONES[0];

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm hover:border-border-strong transition"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={t("settings.timezone")}
      >
        <Clock size={15} className="text-accent" />
        <span>{current.id === "auto" ? t("settings.timezoneAuto") : current.label}</span>
        <ChevronDown size={14} className="text-faint" />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute right-0 z-50 mt-2 w-48 max-h-72 overflow-y-auto rounded-lg border border-border-strong bg-surface-2 p-1 shadow-2xl"
        >
          {TIMEZONES.map((tz) => (
            <button
              key={tz.id}
              role="option"
              aria-selected={tz.id === timezone}
              onClick={() => {
                setTimezone(tz.id);
                setOpen(false);
              }}
              className="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-sm hover:bg-surface transition"
            >
              <span className="flex-1">{tz.id === "auto" ? t("settings.timezoneAuto") : tz.label}</span>
              {tz.id === timezone && <Check size={15} className="text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
