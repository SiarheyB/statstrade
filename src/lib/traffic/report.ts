// Сборка всего отчёта раздела «Трафик» одним вызовом.
//
// Все запросы уходят параллельно: страница серверная, ждать десять
// последовательных агрегаций нельзя — раздел должен открываться мгновенно.

import { periodBounds, previousBounds, delta, type PeriodKey } from "./periods";
import {
  getBots, getBreakdown, getCampaigns, getLive, getRecentVisits, getSeries, getSessionStats,
  getSources, getTopPages, getTotals,
  type Audience, type BotRow, type BreakdownRow, type CampaignRow, type LiveState, type PageRow,
  type SeriesPoint, type SessionStats, type SourceRow, type Totals, type TrafficRange, type VisitRow,
} from "./query";

/** Просмотры и посетители в том срезе, который выбран переключателем. */
function scopeTotals(t: Totals, audience: Audience): { views: number; visitors: number } {
  if (audience === "human") return { views: t.humanViews, visitors: t.humanVisitors };
  if (audience === "bot") return { views: t.botViews, visitors: t.botVisitors };
  return { views: t.views, visitors: t.visitors };
}

export type TrafficReport = {
  range: { from: string; to: string; bucket: "day" | "hour" };
  totals: Totals;
  /** Просмотры и посетители в выбранном срезе — то, что показывают карточки. */
  scoped: { views: number; visitors: number };
  sessions: SessionStats;
  /** Изменение к предыдущему периоду той же длины: null — сравнивать не с чем. */
  deltas: { views: number | null; visitors: number | null; sessions: number | null };
  /** Сами цифры прошлого периода — чтобы «−40%» можно было прочитать как «было 50, стало 30». */
  previous: { views: number; visitors: number; sessions: number; registered: number };
  series: SeriesPoint[];
  pages: PageRow[];
  sources: SourceRow[];
  campaigns: CampaignRow[];
  devices: BreakdownRow[];
  browsers: BreakdownRow[];
  systems: BreakdownRow[];
  langs: BreakdownRow[];
  countries: BreakdownRow[];
  bots: BotRow[];
  visits: VisitRow[];
  live: LiveState;
};

export async function getTrafficReport(
  period: PeriodKey,
  tzOffsetMin: number,
  audience: Audience,
  now: Date = new Date(),
): Promise<TrafficReport> {
  const b = periodBounds(period, now, tzOffsetMin);
  const range: TrafficRange = { ...b, tzOffsetMin, audience };
  const prevB = previousBounds(b);
  const prev: TrafficRange = { ...prevB, tzOffsetMin, audience };

  const [
    totals, prevTotals, sessions, prevSessions, series, pages, sources, campaigns,
    devices, browsers, systems, langs, countries, bots, visits, live,
  ] = await Promise.all([
    getTotals(range),
    getTotals(prev),
    getSessionStats(range),
    getSessionStats(prev),
    getSeries(range),
    getTopPages(range),
    getSources(range),
    getCampaigns(range),
    getBreakdown(range, "device"),
    getBreakdown(range, "browser"),
    getBreakdown(range, "os"),
    getBreakdown(range, "lang"),
    getBreakdown(range, "country"),
    getBots(range),
    getRecentVisits(range, 40),
    getLive(),
  ]);

  // Карточки показывают выбранный срез: при «Люди» — людей, при «Роботы» —
  // роботов, при «Все» — всех. Раньше они всегда брали human*, из-за чего
  // переключатель на них не действовал: визиты менялись, а посетители и
  // просмотры — нет.
  const scoped = scopeTotals(totals, audience);
  const prevScoped = scopeTotals(prevTotals, audience);

  return {
    range: { from: b.from.toISOString(), to: b.to.toISOString(), bucket: b.bucket },
    totals,
    scoped,
    sessions,
    deltas: {
      views: delta(scoped.views, prevScoped.views),
      visitors: delta(scoped.visitors, prevScoped.visitors),
      sessions: delta(sessions.sessions, prevSessions.sessions),
    },
    previous: {
      views: prevScoped.views,
      visitors: prevScoped.visitors,
      sessions: prevSessions.sessions,
      registered: prevSessions.registered,
    },
    series,
    pages,
    sources,
    campaigns,
    devices,
    browsers,
    systems,
    langs,
    countries,
    bots,
    visits,
    live,
  };
}
