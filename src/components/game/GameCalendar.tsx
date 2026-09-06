"use client";

// Календарь публикаций и лента новостей — в одном разделе, с тем же
// переключателем периода, что в экономическом календаре проекта.
//
// Зачем календарь: часть новостей в жизни известна заранее — заседание по
// ставке, отчёт по занятости, публикация инфляции. К ним готовятся: закрывают
// позиции, ставят стопы шире, ждут. У нас же любая новость приходила
// ниоткуда, и подготовиться было не к чему — оставалось только терпеть.
//
// Календарь показывает ЧТО и КОГДА выйдет, но не показывает РЕЗУЛЬТАТ:
// направление считается в тот же час, что и сама публикация. Иначе игра
// свелась бы к чтению будущего.
import { useEffect, useMemo, useState } from "react";
import { CalendarClock } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import NewsFeed from "./NewsFeed";
import type { Asset, NewsEvent, NewsImpact } from "@/engine/entities/types";

type Scope = "today" | "tomorrow" | "week" | "nextWeek";

const SCOPES: Scope[] = ["today", "tomorrow", "week", "nextWeek"];

const IMPACT_STYLE: Record<NewsImpact, string> = {
  low: "bg-surface-2 text-muted",
  medium: "bg-accent/15 text-accent",
  high: "bg-loss/15 text-loss",
  black_swan: "bg-loss text-white",
};

interface CalendarEvent {
  ts: number;
  impact: NewsImpact;
  title: string;
  /** Тикер, если событие про конкретную бумагу (отчётность). */
  symbol: string | null;
}

const DAY = 24 * 60 * 60 * 1000;

/** Границы периода. Неделя считается от понедельника, как в календаре проекта. */
function rangeOf(scope: Scope, now: number): { from: number; to: number } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const dayStart = start.getTime();
  if (scope === "today") return { from: dayStart, to: dayStart + DAY };
  if (scope === "tomorrow") return { from: dayStart + DAY, to: dayStart + 2 * DAY };
  // Понедельник текущей недели: getDay() воскресенье = 0, поэтому сдвигаем.
  const weekday = (new Date(dayStart).getDay() + 6) % 7;
  const monday = dayStart - weekday * DAY;
  return scope === "week" ? { from: monday, to: monday + 7 * DAY } : { from: monday + 7 * DAY, to: monday + 14 * DAY };
}

export default function GameCalendar({
  news,
  assets,
  gameElapsedMs,
  radarAssetIds,
}: {
  news: NewsEvent[];
  assets: Asset[];
  gameElapsedMs: number;
  radarAssetIds?: string[];
}) {
  const { t } = useI18n();
  const [scope, setScope] = useState<Scope>("today");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  // Часы берём в состояние, а не читаем в рендере: React справедливо считает
  // Date.now() в теле компонента нечистотой.
  const [now, setNow] = useState(0);

  useEffect(() => {
    setNow(Date.now());
  }, []);

  const range = useMemo(() => (now > 0 ? rangeOf(scope, now) : null), [scope, now]);

  useEffect(() => {
    if (!range) return;
    let alive = true;
    setLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/game/calendar?from=${range.from}&to=${range.to}`);
        if (!alive) return;
        const data = res.ok ? await res.json() : { events: [] };
        setEvents((data.events ?? []) as CalendarEvent[]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [range]);

  // Прошедшие публикации показываем блёкло: они уже в ленте новостей, а в
  // календаре нужны только чтобы не терять контекст дня.
  const rows = events.slice().sort((a, b) => a.ts - b.ts);

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex items-center gap-2 text-sm font-medium">
            <CalendarClock size={15} className="text-accent" />
            {t("game.calendar.title")}
          </div>
          <div className="flex flex-wrap gap-1">
            {SCOPES.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setScope(key)}
                className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                  scope === key ? "bg-accent text-white" : "bg-surface-2 text-muted hover:text-fg"
                }`}
              >
                {t(`game.calendar.scope.${key}`)}
              </button>
            ))}
          </div>
        </div>

        <p className="text-[11px] text-faint max-w-prose">{t("game.calendar.hint")}</p>

        {loading ? (
          <div className="text-xs text-faint">{t("game.world.loading")}</div>
        ) : rows.length === 0 ? (
          <div className="text-xs text-faint">{t("game.calendar.empty")}</div>
        ) : (
          <div className="space-y-1">
            {rows.map((event) => {
              const past = now > 0 && event.ts < now;
              return (
                <div
                  key={`${event.ts}-${event.title}`}
                  className={`flex items-center gap-2 border-t border-border pt-1.5 text-xs ${past ? "opacity-50" : ""}`}
                >
                  <span className={`px-1.5 py-0.5 rounded shrink-0 ${IMPACT_STYLE[event.impact]}`}>
                    {t(`game.news.impact.${event.impact}`)}
                  </span>
                  <span className="text-faint tabular-nums shrink-0 w-[92px]">
                    {new Date(event.ts).toLocaleString(undefined, {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  {event.symbol && (
                    <span className="shrink-0 font-medium text-accent w-[58px]">{event.symbol}</span>
                  )}
                  <span className="flex-1 min-w-0">{event.title}</span>
                  {!past && <span className="shrink-0 text-accent">{t("game.calendar.ahead")}</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <NewsFeed news={news} assets={assets} gameElapsedMs={gameElapsedMs} expanded radarAssetIds={radarAssetIds} />
    </div>
  );
}
