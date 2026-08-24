/**
 * SessionPicker — включение подсветки торговых сессий на графике форекса.
 *
 * Каждая сессия включается отдельно, поэтому это не одна кнопка, а маленькое
 * меню: три строки с цветом сессии и её часами. Часы показываются В ТАЙМЗОНЕ
 * ПОЛЬЗОВАТЕЛЯ (настройка приложения) — открытие Лондона в 10:00 для UTC+3 и
 * в 07:00 для UTC — иначе непонятно, почему коробка стоит именно там.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { zonedParts, type TimezoneId } from "@/lib/timezone";
import { TRADING_SESSIONS, sessionTodayWindow, type SessionId } from "@/lib/tradingSessions";

type Props = {
  value: SessionId[];
  onToggle: (id: SessionId) => void;
  timezone: TimezoneId;
};

const LABEL_KEY: Record<SessionId, string> = {
  tokyo: "fx.sessionTokyo",
  london: "fx.sessionLondon",
  newYork: "fx.sessionNewYork",
};

/** «10:00 – 19:00» в таймзоне пользователя. */
function hoursLabel(id: SessionId, timezone: TimezoneId, now: number): string {
  const w = sessionTodayWindow(id, now);
  if (!w) return "";
  const hm = (ms: number) => {
    const { h, mi } = zonedParts(ms, timezone);
    return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
  };
  return `${hm(w.start)} – ${hm(w.end)}`;
}

export default function SessionPicker({ value, onToggle, timezone }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  // Часы сессий зависят от даты (летнее время), поэтому «сейчас» фиксируется
  // в момент открытия меню — в самом рендере Date.now() звать нельзя.
  const [now, setNow] = useState(0);

  const handleOpen = useCallback(() => {
    setNow(Date.now());
    setOpen((v) => !v);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = useCallback((id: SessionId) => () => onToggle(id), [onToggle]);

  const active = value.length > 0;

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={handleOpen}
        aria-expanded={open}
        title={t("fx.hintSessions")}
        className={`inline-flex items-center gap-1.5 input-base py-1.5 px-2 text-xs transition ${
          active ? "text-accent border-accent/40" : "text-muted hover:border-border-strong"
        }`}
      >
        <Clock size={12} />
        {t("fx.sessions")}
        {active && <span className="tabular-nums text-[10px] text-faint">{value.length}</span>}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-56 rounded-lg border border-border/60 bg-bg/95 p-1 text-xs shadow-xl backdrop-blur-sm">
          <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-faint">{t("fx.sessionsTitle")}</div>
          {TRADING_SESSIONS.map((s) => {
            const on = value.includes(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={toggle(s.id)}
                aria-pressed={on}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition-colors hover:bg-bg-muted"
              >
                <span
                  className="h-3 w-3 shrink-0 rounded-sm border"
                  style={{
                    backgroundColor: on ? s.color : "transparent",
                    borderColor: on ? s.color : "var(--color-border-strong, #444)",
                  }}
                />
                <span className={on ? "text-fg" : "text-muted"}>{t(LABEL_KEY[s.id])}</span>
                <span className="ml-auto tabular-nums text-faint">{now > 0 ? hoursLabel(s.id, timezone, now) : ""}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
