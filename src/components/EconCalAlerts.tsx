"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { X } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/core";
import { fmtTime } from "@/lib/format";
import { translateEventTitle } from "@/lib/econcalTerms";
import { flagFor } from "@/lib/econcalFlags";
import {
  ALERT_DEMO_EVENT,
  ALERT_SETTINGS_EVENT,
  ALERT_SETTINGS_KEY,
  dueAlerts,
  groupByTime,
  loadAlertSettings,
  loadSeen,
  saveSeen,
  type AlertEvent,
  type EconAlertSettings,
} from "@/lib/econcalAlerts";

// Раз в сколько тянем календарь (у /api/econcal кэш 5 минут — чаще смысла нет).
const POLL_MS = 5 * 60_000;
// Как часто сверяем рубежи. Минута — самый короткий рубеж, 15 с даёт запас.
const TICK_MS = 15_000;
// Сколько окно висит само по себе.
const TOAST_MS = 45_000;
const MAX_TOASTS = 3;
// Горизонт выборки: сутки вперёд с запасом.
const LOOKAHEAD_MS = 26 * 3600_000;

// Окно — на ПАЧКУ событий с одним временем публикации: в 15:30 у США
// регулярно выходит три-четыре показателя сразу, и это одна новость для
// трейдера, а не четыре всплывающих окна.
type Toast = {
  key: string;
  events: AlertEvent[];
  demo?: boolean;
  leaving?: boolean;
};

// Сколько событий пачки показываем списком; остальные — счётчиком «и ещё N».
const MAX_LISTED = 3;

const IMPACT_TONE: Record<string, { text: string; dot: string; wash: string; edge: string }> = {
  high: {
    text: "text-loss",
    dot: "bg-loss",
    wash: "bg-loss/12",
    edge: "border-loss/25",
  },
  medium: {
    text: "text-warn",
    dot: "bg-warn",
    wash: "bg-warn/12",
    edge: "border-warn/25",
  },
  low: {
    text: "text-accent",
    dot: "bg-accent",
    wash: "bg-accent/12",
    edge: "border-accent/25",
  },
};
const toneFor = (impact: string) => IMPACT_TONE[impact] ?? IMPACT_TONE.low;

// «1 минута / 2 минуты / 15 минут» — форму слова выбирает Intl, словарь даёт
// сами слова (в английском их две, в русском три).
function minuteWord(
  n: number,
  locale: Locale,
  t: (k: string, v?: Record<string, string | number>) => string,
): string {
  const rule = new Intl.PluralRules(locale === "ru" ? "ru-RU" : "en-US").select(n);
  return t(`econcalAlerts.minute.${rule}`);
}

// Короткий сигнал без файла: два тона через WebAudio. Браузер может отказать
// (нет ни одного клика по вкладке) — молча переживаем.
function beep() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const play = (freq: number, at: number, dur: number) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + at);
      gain.gain.exponentialRampToValueAtTime(0.13, ctx.currentTime + at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + at);
      osc.stop(ctx.currentTime + at + dur + 0.02);
    };
    play(880, 0, 0.12);
    play(1320, 0.14, 0.16);
    setTimeout(() => ctx.close().catch(() => {}), 800);
  } catch {
    // звук — не повод ронять уведомление
  }
}

export default function EconCalAlerts() {
  const { t, locale } = useI18n();
  const [settings, setSettings] = useState<EconAlertSettings | null>(null);
  const [events, setEvents] = useState<AlertEvent[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [now, setNow] = useState(0);
  // Показанные рубежи: в ref, чтобы тик не пересобирался от каждой записи.
  const seenRef = useRef<Map<string, number>>(new Map());

  // Настройки читаются только в браузере (localStorage): до первого эффекта
  // settings === null и компонент ничего не рисует — серверный HTML пустой,
  // гидратация не расходится.
  useEffect(() => {
    setSettings(loadAlertSettings());
    seenRef.current = loadSeen();
    const onChange = () => setSettings(loadAlertSettings());
    const onStorage = (e: StorageEvent) => {
      if (e.key === ALERT_SETTINGS_KEY) setSettings(loadAlertSettings());
    };
    window.addEventListener(ALERT_SETTINGS_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(ALERT_SETTINGS_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const enabled = settings?.enabled ?? false;

  const load = useCallback(async () => {
    const from = new Date(Date.now() - 3600_000).toISOString();
    const to = new Date(Date.now() + LOOKAHEAD_MS).toISOString();
    try {
      const res = await fetch(`/api/econcal?from=${from}&to=${to}`);
      if (!res.ok) return;
      const d = await res.json();
      setEvents(Array.isArray(d.events) ? (d.events as AlertEvent[]) : []);
    } catch {
      // Сеть моргнула — следующий опрос через POLL_MS.
    }
  }, []);

  // Опрос календаря + догрузка при возвращении на вкладку (ноутбук спал —
  // интервалы в фоне могли не отработать).
  useEffect(() => {
    if (!enabled) return;
    load();
    const iv = setInterval(load, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, load]);

  // Часы: они же двигают обратный отсчёт в уже открытых окнах. Тикают и при
  // выключенных уведомлениях, если на экране висит окно (тестовое из настроек).
  const ticking = enabled || toasts.length > 0;
  useEffect(() => {
    if (!ticking) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const iv = setInterval(tick, TICK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(iv);
    };
  }, [ticking]);

  const dismiss = useCallback((key: string) => {
    setToasts((prev) => prev.map((x) => (x.key === key ? { ...x, leaving: true } : x)));
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.key !== key)), 220);
  }, []);

  // Собственно проверка рубежей.
  useEffect(() => {
    if (!settings || !enabled || !now) return;
    const due = dueAlerts(events, settings, now, new Set(seenRef.current.keys()));
    if (!due.length) return;

    for (const d of due) {
      const ts = Date.parse(d.event.time);
      for (const k of d.keys) seenRef.current.set(k, ts);
    }
    saveSeen(seenRef.current);

    setToasts((prev) => {
      const shown = new Set(prev.flatMap((p) => p.events.map((e) => e.id)));
      const fresh = groupByTime(due.filter((d) => !shown.has(d.event.id))).map((g) => ({
        key: `${g.time}:${now}`,
        events: g.events,
      }));
      return [...prev, ...fresh].slice(-MAX_TOASTS);
    });

    if (settings.sound) beep();
    if (settings.system && typeof Notification !== "undefined" && Notification.permission === "granted") {
      const minutesLeft = new Map(due.map((d) => [d.event.time, d.minutesLeft]));
      for (const g of groupByTime(due)) {
        try {
          new Notification(t("econcalAlerts.systemTitle", { m: minutesLeft.get(g.time) ?? 0 }), {
            body: `${g.events.map((e) => translateEventTitle(e.title, locale)).join(" · ")} — ${fmtTime(g.time)}`,
            tag: g.time,
          });
        } catch {
          // системные уведомления недоступны — окно в приложении уже показано
        }
      }
    }
  }, [events, settings, enabled, now, t, locale]);

  // Тестовое окно из настроек — чтобы человек увидел, как это выглядит,
  // не дожидаясь новостей.
  useEffect(() => {
    const onDemo = () => {
      const at = new Date(Date.now() + 15 * 60_000).toISOString();
      setToasts((prev) =>
        [
          ...prev,
          {
            key: `demo:${Date.now()}`,
            demo: true,
            events: [
              {
                id: `demo-${Date.now()}`,
                time: at,
                currency: "USD",
                title: "Non-Farm Employment Change",
                impact: "high",
                forecast: "190K",
                previous: "227K",
              },
            ],
          },
        ].slice(-MAX_TOASTS),
      );
      setNow(Date.now());
    };
    window.addEventListener(ALERT_DEMO_EVENT, onDemo);
    return () => window.removeEventListener(ALERT_DEMO_EVENT, onDemo);
  }, []);

  if (!toasts.length) return null;

  return (
    <div
      className="fixed z-[90] bottom-4 right-4 left-4 sm:left-auto sm:w-[24rem] flex flex-col gap-2 pointer-events-none"
      role="region"
      aria-live="polite"
      aria-label={t("econcalAlerts.title")}
    >
      {toasts.map((toast) => (
        <AlertToast
          key={toast.key}
          toast={toast}
          now={now}
          locale={locale}
          t={t}
          onClose={() => dismiss(toast.key)}
        />
      ))}
    </div>
  );
}

function AlertToast({
  toast,
  now,
  locale,
  t,
  onClose,
}: {
  toast: Toast;
  now: number;
  locale: Locale;
  t: (k: string, v?: Record<string, string | number>) => string;
  onClose: () => void;
}) {
  const events = toast.events;
  const lead = events[0];
  // Тон окна — по самой важной новости пачки.
  const tone = toneFor(lead.impact);
  const ts = Date.parse(lead.time);
  const minutes = Math.max(0, Math.round((ts - now) / 60_000));
  const released = ts - now < -30_000;
  const listed = events.slice(0, MAX_LISTED);
  const rest = events.length - listed.length;
  const currencies = [...new Set(events.map((e) => e.currency))].join(", ");

  // Автозакрытие замирает под курсором: человек читает — окно не убегает.
  const [paused, setPaused] = useState(false);
  const lifeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (paused) return;
    const id = setTimeout(onClose, TOAST_MS);
    return () => clearTimeout(id);
  }, [onClose, paused]);
  useEffect(() => {
    if (lifeRef.current) lifeRef.current.style.animationPlayState = paused ? "paused" : "running";
  }, [paused]);

  return (
    <div
      className={clsx(
        "card overflow-hidden pointer-events-auto relative",
        "shadow-[0_24px_60px_-20px_rgba(0,0,0,0.85)]",
        toast.leaving ? "toast-out" : "toast-in",
      )}
      // Окно висит поверх плотного текста — прозрачность карточки тут мешает
      // читать, поэтому фон непрозрачный.
      style={{ backgroundColor: "var(--color-surface)" }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      role="alert"
    >
      <div className="flex">
        {/* Слева — крупный отсчёт: главное, что нужно увидеть боковым зрением. */}
        <div
          className={clsx(
            "w-[5.5rem] shrink-0 flex flex-col items-center justify-center border-r px-2 py-3",
            tone.wash,
            tone.edge,
          )}
        >
          <div className={clsx("text-[26px] font-bold leading-none tabular-nums", tone.text)}>
            {released ? "•" : minutes}
          </div>
          <div className="text-[10px] uppercase tracking-wider text-muted mt-1 text-center">
            {released ? t("econcalAlerts.released") : minuteWord(minutes, locale, t)}
          </div>
        </div>

        <div className="min-w-0 flex-1 px-3.5 py-2.5">
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-faint">
                <span className={clsx("h-1.5 w-1.5 rounded-full", tone.dot)} />
                {t(`econcal.impact.${lead.impact}`)}
                {toast.demo && <span className="text-faint">· {t("econcalAlerts.demoTag")}</span>}
              </div>

              {/* Пачка событий одной минуты: одно — с прогнозом, несколько —
                  списком названий (в 15:30 у США их регулярно три-четыре). */}
              <ul className="mt-0.5 space-y-0.5">
                {listed.map((e) => (
                  <li
                    key={e.id}
                    className={clsx(
                      "font-semibold flex items-start gap-1.5 min-w-0",
                      // В пачке строк больше — чуть мельче, чтобы влезало название.
                      events.length > 1 ? "text-[13px]" : "text-sm",
                    )}
                  >
                    <span className="shrink-0">{flagFor(e.currency)}</span>
                    <span
                      className={clsx("leading-snug", events.length > 1 ? "line-clamp-1" : "line-clamp-2")}
                      title={e.title}
                    >
                      {translateEventTitle(e.title, locale)}
                    </span>
                  </li>
                ))}
              </ul>
              {rest > 0 && (
                <div className="text-[11px] text-faint mt-0.5">
                  {t("econcalAlerts.andMore", { n: rest })}
                </div>
              )}

              <div className="text-[11px] text-faint mt-1 flex flex-wrap items-center gap-x-2.5 tabular-nums">
                <span>
                  {currencies} · {fmtTime(lead.time)}
                </span>
                {events.length === 1 && lead.forecast && (
                  <span>
                    {t("econcal.forecast").toLowerCase()} {lead.forecast}
                  </span>
                )}
                {events.length === 1 && lead.previous && (
                  <span>
                    {t("econcal.previous").toLowerCase()} {lead.previous}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              aria-label={t("econcalAlerts.dismiss")}
              className="shrink-0 -mr-1 -mt-0.5 p-1 rounded-md text-faint hover:text-fg hover:bg-surface-2 transition"
            >
              <X size={14} />
            </button>
          </div>

          <div className="mt-2">
            <Link
              href="/dashboard/econcal"
              onClick={onClose}
              className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 transition"
            >
              {t("econcalAlerts.openCalendar")}
            </Link>
          </div>
        </div>
      </div>

      {/* Полоса жизни окна — видно, что оно закроется само. */}
      <div
        ref={lifeRef}
        className={clsx("toast-life absolute bottom-0 inset-x-0 h-0.5 opacity-40", tone.dot)}
        style={{ animationDuration: `${TOAST_MS}ms` }}
      />
    </div>
  );
}
