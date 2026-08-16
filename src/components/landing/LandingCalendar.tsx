import Link from "next/link";
import { CalendarDays } from "lucide-react";
import type { LandingEvent } from "@/lib/landing";
import type { Locale } from "@/lib/i18n/core";
import type { TimezoneId } from "@/lib/timezone";
import { ianaFor } from "@/lib/timezone";
import { flagFor } from "@/lib/econcal";

/**
 * Календарь на ближайшие дни для гостя: ближайшее событие подсвечено,
 * прошедшие приглушены и показывают факт вместо прогноза.
 *
 * Время рисуется через Intl с ЯВНОЙ таймзоной, а не через fmtDate/fmtTime:
 * те держат зону в модульной переменной, а серверный рендер общий для всех
 * запросов — чужая зона протекла бы между посетителями.
 */

const IMPACT_STARS: Record<string, string> = { high: "★★★", medium: "★★", low: "★" };
const IMPACT_CLASS: Record<string, string> = {
  high: "text-loss",
  medium: "text-warn",
  low: "text-faint",
};

function makeFormatters(locale: Locale, tz: TimezoneId) {
  const timeZone = ianaFor(tz);
  const l = locale === "ru" ? "ru-RU" : "en-US";
  return {
    // hourCycle h23 — 24-часовой формат в обеих локалях: колонка времени узкая,
    // и "01:30 AM" в en-US ломает её на две строки.
    time: new Intl.DateTimeFormat(l, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", ...(timeZone ? { timeZone } : {}) }),
    day: new Intl.DateTimeFormat(l, { weekday: "long", day: "numeric", month: "long", ...(timeZone ? { timeZone } : {}) }),
    dayKey: new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", ...(timeZone ? { timeZone } : {}) }),
  };
}

export default function LandingCalendar({
  events,
  locale,
  timezone,
  now,
  t,
}: {
  events: LandingEvent[];
  locale: Locale;
  timezone: TimezoneId;
  now: number;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  const fmt = makeFormatters(locale, timezone);

  // Ближайшее ещё не наступившее событие — единственная подсвеченная строка.
  const nextId = events.find((e) => Date.parse(e.time) >= now)?.id ?? null;

  // «Сегодня»/«Завтра» — по календарным суткам В ЗОНЕ ПОСЕТИТЕЛЯ, а не по
  // порядку групп: срез собирается от полуночи UTC, и у зоны с большим
  // сдвигом первая группа вполне может быть уже завтрашним днём.
  // Ближайшее событие показывает не прогноз, а сколько до него осталось — это
  // то, ради чего на календарь смотрят утром.
  const countdown = (ts: number): string => {
    const mins = Math.max(0, Math.round((ts - now) / 60_000));
    if (mins === 0) return t("landing.calendar.now");
    if (mins < 60) return t("landing.calendar.inMinutes", { m: mins });
    return t("landing.calendar.inHours", { h: Math.floor(mins / 60), m: mins % 60 });
  };

  const todayKey = fmt.dayKey.format(new Date(now));
  const tomorrowKey = fmt.dayKey.format(new Date(now + 86_400_000));

  const days: { key: string; label: string; events: LandingEvent[] }[] = [];
  for (const e of events) {
    const key = fmt.dayKey.format(new Date(e.time));
    const last = days[days.length - 1];
    if (last && last.key === key) last.events.push(e);
    else days.push({ key, label: fmt.day.format(new Date(e.time)), events: [e] });
  }

  return (
    <div className="card p-0 overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <span className="flex items-center gap-2 text-sm font-medium">
          <CalendarDays size={16} className="text-accent" />
          {t("landing.calendar.title")}
        </span>
        <Link href="/calendar" className="text-xs text-accent hover:underline">
          {t("landing.calendar.more")} →
        </Link>
      </div>

      {days.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">{t("landing.calendar.empty")}</p>
      ) : (
        days.map((day) => (
          <div key={day.key}>
            <div className="px-4 py-2 bg-surface-2 border-y border-border text-[11px] uppercase tracking-wide text-muted">
              {day.key === todayKey
                ? `${t("landing.calendar.today")}, ${day.label}`
                : day.key === tomorrowKey
                  ? `${t("landing.calendar.tomorrow")}, ${day.label}`
                  : day.label}
            </div>
            <table className="w-full text-[13px]">
              <tbody>
                {day.events.map((e) => {
                  const ts = Date.parse(e.time);
                  const isPast = ts < now;
                  const isNext = e.id === nextId;
                  return (
                    <tr
                      key={e.id}
                      className={[
                        "border-b border-border last:border-0",
                        isPast ? "opacity-50" : "",
                        isNext ? "bg-accent/10 shadow-[inset_2px_0_0_var(--color-accent)]" : "",
                      ].join(" ")}
                    >
                      <td className="px-4 py-2 w-14 text-faint tabular-nums">{fmt.time.format(new Date(ts))}</td>
                      <td className="py-2 pr-2">
                        <span className={`mr-1.5 text-[10px] tracking-widest ${IMPACT_CLASS[e.impact] ?? "text-faint"}`}>
                          {IMPACT_STARS[e.impact] ?? ""}
                        </span>
                        <span className="mr-1">{flagFor(e.currency)}</span>
                        {e.title}
                      </td>
                      <td
                        className={`px-4 py-2 text-right whitespace-nowrap tabular-nums ${
                          isNext ? "text-accent" : e.actual ? "text-profit" : "text-muted"
                        }`}
                      >
                        {isNext
                          ? countdown(ts)
                          : (e.actual ?? (e.forecast ? `${t("landing.calendar.forecast")} ${e.forecast}` : "—"))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))
      )}
    </div>
  );
}
