"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { RefreshCw, Plug, Database, Image as ImageIcon, FileText, CalendarRange } from "lucide-react";
import type { StatsResponse, SerializedTrade } from "@/lib/types";
import { StatCard, StatRow } from "@/components/StatCard";
import { EquityChart, DailyPnlChart, BreakdownChart } from "@/components/charts";
import PnlHeatmap from "@/components/PnlHeatmap";
import RiskBanner from "@/components/RiskBanner";
import { nodeToPng, nodeToPdf, dateStamp } from "@/lib/export";
import {
  METRIC_GROUPS,
  TOTAL_METRICS,
  formatMetric,
  metricTone,
} from "@/lib/analytics/metric-defs";
import type { Metrics } from "@/lib/analytics/metrics";
import { Term } from "@/components/Term";
import { matchTerm } from "@/lib/glossary";
import { useI18n } from "@/lib/i18n/provider";
import { fmtUsd, fmtPct, fmtRatio, fmtDuration, fmtNum, fmtSymbol } from "@/lib/format";

const UNSET = "__unset__";
const SELECT_CLS = "input-base text-sm py-1.5 cursor-pointer";

type Filters = {
  accountId: string;
  market: string;
  symbol: string;
  entryPoint: string;
  entryType: string;
  pattern: string;
  mistake: string;
  range: string; // 7d | 30d | 90d | ytd | all
};

const RANGE_OPTIONS = ["all", "7d", "30d", "90d", "ytd"] as const;

// Start timestamp (ms) for a range preset, or null for "all".
function rangeFrom(range: string): number | null {
  const now = Date.now();
  const DAY = 86_400_000;
  switch (range) {
    case "7d":
      return now - 7 * DAY;
    case "30d":
      return now - 30 * DAY;
    case "90d":
      return now - 90 * DAY;
    case "ytd":
      return new Date(new Date().getFullYear(), 0, 1).getTime();
    default:
      return null;
  }
}

// Client-side "last 30 days vs prior 30 days" trend for headline cards.
// Returns null when either window has no trades. Values are designed to stay
// readable: Net P&L and Win Rate as percentage-point deltas; ratio metrics as a
// relative %, guarded against sign flips / zero base and clamped.
function computeTrend(trades: SerializedTrade[], capital: number) {
  const now = Date.now();
  const D30 = 30 * 86_400_000;
  const ms = (t: SerializedTrade) => new Date(t.exitTime).getTime();
  const recent = trades.filter((t) => ms(t) >= now - D30);
  const prior = trades.filter((t) => ms(t) >= now - 2 * D30 && ms(t) < now - D30);
  if (recent.length === 0 || prior.length === 0) return null;

  const agg = (arr: SerializedTrade[]) => {
    const net = arr.reduce((s, t) => s + t.netPnl, 0);
    const wins = arr.filter((t) => t.result === "win");
    const gp = wins.reduce((s, t) => s + t.netPnl, 0);
    const gl = Math.abs(
      arr.filter((t) => t.result === "loss").reduce((s, t) => s + t.netPnl, 0),
    );
    return {
      net,
      winRate: (wins.length / arr.length) * 100,
      pf: gl > 0 ? gp / gl : gp > 0 ? Infinity : 0,
      exp: net / arr.length,
    };
  };
  const r = agg(recent);
  const p = agg(prior);
  const clamp = (x: number) => Math.max(-300, Math.min(300, x));
  // Relative %, only meaningful when both periods share a sign and base ≠ 0.
  const rel = (a: number, b: number) =>
    b !== 0 && Number.isFinite(a) && Math.sign(a) === Math.sign(b)
      ? clamp(((a - b) / Math.abs(b)) * 100)
      : null;
  const cap = capital > 0 ? capital : 10000;
  return {
    // Δ of period return on capital (percentage points) — bounded & always shown.
    netPnl: ((r.net - p.net) / cap) * 100,
    winRate: r.winRate - p.winRate,
    profitFactor:
      Number.isFinite(p.pf) && p.pf > 0 && Number.isFinite(r.pf)
        ? clamp(((r.pf - p.pf) / p.pf) * 100)
        : null,
    expectancy: rel(r.exp, p.exp),
  };
}

export default function DashboardPage() {
  const { t } = useI18n();
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accountsBal, setAccountsBal] = useState<{ id: string; balance: number | null }[]>([]);
  const [filters, setFilters] = useState<Filters>({
    accountId: "all",
    market: "all",
    symbol: "all",
    entryPoint: "all",
    entryType: "all",
    pattern: "all",
    mistake: "all",
    range: "all",
  });
  const [timeTab, setTimeTab] = useState<"dow" | "hour" | "month">("month");
  const [entryMetric, setEntryMetric] = useState<"netPnl" | "winRate">("netPnl");
  const [patternMetric, setPatternMetric] = useState<"netPnl" | "winRate">("netPnl");
  const [dailyMetric, setDailyMetric] = useState<"pnl" | "winRate">("pnl");
  const [exchangeMetric, setExchangeMetric] = useState<"netPnl" | "winRate">("netPnl");
  const [exporting, setExporting] = useState<null | "png" | "pdf">(null);
  const dashRef = useRef<HTMLDivElement>(null);

  // Capital = exchange balance: the selected account's balance, or the sum of
  // all connected accounts when "all" is selected. Not user-editable.
  const capital = useMemo(() => {
    const sel =
      filters.accountId === "all"
        ? accountsBal
        : accountsBal.filter((a) => a.id === filters.accountId);
    const sum = sel.reduce((s, a) => s + (a.balance ?? 0), 0);
    return sum > 0 ? sum : 10000;
  }, [accountsBal, filters.accountId]);

  async function exportDashboard(kind: "png" | "pdf") {
    if (!dashRef.current) return;
    setExporting(kind);
    try {
      const name = `dashboard-${dateStamp()}.${kind}`;
      if (kind === "png") await nodeToPng(dashRef.current, name);
      else await nodeToPdf(dashRef.current, name, "p");
    } finally {
      setExporting(null);
    }
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        accountId: filters.accountId,
        market: filters.market,
        symbol: filters.symbol,
        entryPoint: filters.entryPoint,
        entryType: filters.entryType,
        pattern: filters.pattern,
        mistake: filters.mistake,
        initialCapital: String(capital),
      });
      const fromMs = rangeFrom(filters.range);
      if (fromMs != null) params.set("from", new Date(fromMs).toISOString());
      const res = await fetch(`/api/stats?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Error");
      setData(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [filters, capital]);

  useEffect(() => {
    load();
  }, [load]);

  // Load per-account balances (the capital source) once on mount.
  useEffect(() => {
    (async () => {
      const res = await fetch("/api/accounts");
      if (res.ok) {
        const accs = (await res.json()) as { id: string; balance: number | null }[];
        setAccountsBal(accs.map((a) => ({ id: a.id, balance: a.balance })));
      }
    })();
  }, []);

  const m = data?.metrics;
  const hasAccounts = (data?.accounts.length ?? 0) > 0;
  const hasTrades = (m?.tradeCount ?? 0) > 0;
  const entryMetricLabel = entryMetric === "netPnl" ? t("metric.pnl") : t("metric.winRateShort");
  const trend = useMemo(
    () => (data?.trades ? computeTrend(data.trades, capital) : null),
    [data, capital],
  );

  return (
    <div className="px-6 py-5 max-w-7xl mx-auto">
      {/* Header + filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-semibold">{t("dash.title")}</h1>
          <p className="text-sm text-muted">
            {data
              ? t("dash.subtitle", { trades: m?.tradeCount ?? 0, fills: data.fillCount })
              : t("common.loading")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 pl-2.5 pr-1 py-0.5">
            <CalendarRange size={14} className="text-accent" />
            <select
              className="bg-transparent text-sm py-1 pr-1 outline-none cursor-pointer"
              value={filters.range}
              onChange={(e) => setFilters((f) => ({ ...f, range: e.target.value }))}
            >
              {RANGE_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {t(`dash.range.${r}`)}
                </option>
              ))}
            </select>
          </div>
          <select
            className={SELECT_CLS}
            value={filters.accountId}
            onChange={(e) => setFilters((f) => ({ ...f, accountId: e.target.value }))}
          >
            <option value="all">{t("dash.allAccounts")}</option>
            {data?.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} ({a.exchange})
              </option>
            ))}
          </select>
          <select
            className={SELECT_CLS}
            value={filters.market}
            onChange={(e) => setFilters((f) => ({ ...f, market: e.target.value }))}
          >
            <option value="all">{t("dash.allMarkets")}</option>
            <option value="spot">{t("dash.spot")}</option>
            <option value="futures">{t("dash.futures")}</option>
            <option value="forex">{t("dash.forex")}</option>
          </select>
          <select
            className={SELECT_CLS}
            value={filters.symbol}
            onChange={(e) => setFilters((f) => ({ ...f, symbol: e.target.value }))}
          >
            <option value="all">{t("dash.allSymbols")}</option>
            {data?.symbols.map((s) => (
              <option key={s} value={s}>{fmtSymbol(s)}</option>
            ))}
          </select>
          <select
            className={SELECT_CLS}
            value={filters.entryPoint}
            onChange={(e) => setFilters((f) => ({ ...f, entryPoint: e.target.value }))}
          >
            <option value="all">{t("dash.allEntryPoints")}</option>
            {data?.entryPointOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
            <option value={UNSET}>{t("common.unset")}</option>
          </select>
          <select
            className={SELECT_CLS}
            value={filters.entryType}
            onChange={(e) => setFilters((f) => ({ ...f, entryType: e.target.value }))}
          >
            <option value="all">{t("dash.allEntryTypes")}</option>
            {data?.entryTypeOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
            <option value={UNSET}>{t("common.unset")}</option>
          </select>
          <select
            className={SELECT_CLS}
            value={filters.pattern}
            onChange={(e) => setFilters((f) => ({ ...f, pattern: e.target.value }))}
          >
            <option value="all">{t("dash.allPatterns")}</option>
            {data?.patternOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
            <option value={UNSET}>{t("common.unset")}</option>
          </select>
          <select
            className={SELECT_CLS}
            value={filters.mistake}
            onChange={(e) => setFilters((f) => ({ ...f, mistake: e.target.value }))}
          >
            <option value="all">{t("dash.allMistakes")}</option>
            {data?.mistakeOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
            <option value={UNSET}>{t("common.unset")}</option>
          </select>
          <div className="flex items-center gap-1.5 input-base py-1.5" title={t("dash.capitalHint")}>
            <span className="text-xs text-faint">{t("dash.capital")}</span>
            <span className="text-sm tabular-nums font-medium">{fmtUsd(capital)}</span>
          </div>
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 input-base py-1.5 hover:border-border-strong transition"
            title={t("dash.refresh")}
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => exportDashboard("png")}
            disabled={!hasTrades || exporting !== null}
            className="inline-flex items-center gap-1.5 input-base py-1.5 text-sm hover:border-border-strong transition disabled:opacity-50"
          >
            <ImageIcon size={14} /> {exporting === "png" ? "…" : "PNG"}
          </button>
          <button
            onClick={() => exportDashboard("pdf")}
            disabled={!hasTrades || exporting !== null}
            className="inline-flex items-center gap-1.5 input-base py-1.5 text-sm hover:border-border-strong transition disabled:opacity-50"
          >
            <FileText size={14} /> {exporting === "pdf" ? "…" : "PDF"}
          </button>
        </div>
      </div>

      <RiskBanner accountId={filters.accountId} />

      {error && (
        <div className="card p-4 text-sm text-loss border-loss/30 mb-5">{error}</div>
      )}

      {!loading && !hasAccounts && (
        <EmptyState
          icon={<Plug size={28} />}
          title={t("dash.empty.connectTitle")}
          text={t("dash.empty.connectText")}
          actionHref="/dashboard/accounts"
          actionLabel={t("dash.empty.connectAction")}
        />
      )}

      {!loading && hasAccounts && !hasTrades && (
        <EmptyState
          icon={<Database size={28} />}
          title={t("dash.empty.noTradesTitle")}
          text={t("dash.empty.noTradesText")}
          actionHref="/dashboard/accounts"
          actionLabel={t("dash.empty.noTradesAction")}
        />
      )}

      {m && hasTrades && (
        <div className="space-y-5" ref={dashRef}>
          {/* Headline stats */}
          <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
            <StatCard
              label={<Term name="P&L">{t("dash.card.netPnl")}</Term>}
              value={fmtUsd(m.totalNetPnl, { sign: true })}
              hint={<><Term name="ROI">{t("dash.card.roi")}</Term> {fmtPct(m.roiPct)}</>}
              tone={m.totalNetPnl >= 0 ? "profit" : "loss"}
              change={trend?.netPnl}
              changeUnit=" pp"
              changeHint={t("dash.trend30")}
            />
            <StatCard
              label={<Term name="Win Rate">{t("dash.card.winRate")}</Term>}
              value={`${m.winRate.toFixed(1)}%`}
              hint={
                <Term desc={t("dash.card.winRateHint")}>
                  {t("dash.wlBe", { w: m.wins, l: m.losses, be: m.breakevens })}
                </Term>
              }
              change={trend?.winRate}
              changeUnit=" pp"
              changeHint={t("dash.trend30")}
            />
            <StatCard
              label={<Term name="Profit Factor">{t("dash.card.profitFactor")}</Term>}
              value={fmtRatio(m.profitFactor)}
              hint={<><Term name="Payoff">{t("dash.card.payoff")}</Term> {fmtRatio(m.payoffRatio)}</>}
              tone={m.profitFactor >= 1 ? "profit" : "loss"}
              change={trend?.profitFactor}
              changeHint={t("dash.trend30")}
            />
            <StatCard
              label={<Term name="Expectancy">{t("dash.card.expectancy")}</Term>}
              value={fmtUsd(m.expectancy, { sign: true })}
              hint={`${t("dash.card.avgReturn")} ${fmtPct(m.avgReturnPct)}`}
              tone={m.expectancy >= 0 ? "profit" : "loss"}
              change={trend?.expectancy}
              changeHint={t("dash.trend30")}
            />
            <StatCard
              label={t("dash.card.maxDd")}
              value={fmtUsd(-m.maxDrawdown)}
              hint={`${m.maxDrawdownPct.toFixed(1)}% · ${m.longestDrawdownDays.toFixed(0)} ${t("dash.days")}`}
              tone="loss"
            />
            <StatCard
              label={<Term name="Sharpe">{t("dash.card.sharpe")}</Term>}
              value={fmtRatio(m.sharpe)}
              hint={
                <>
                  <Term name="Sortino">Sortino</Term> {fmtRatio(m.sortino)} ·{" "}
                  <Term name="Calmar">Calmar</Term> {fmtRatio(m.calmar)}
                </>
              }
            />
            <StatCard
              label={t("dash.card.finalEquity")}
              value={fmtUsd(m.finalEquity)}
              hint={`${t("dash.card.start")} ${fmtUsd(m.initialCapital)}`}
              tone="accent"
            />
            <StatCard
              label={t("dash.card.fees")}
              value={fmtUsd(m.totalFees)}
              hint={`${t("dash.card.best")} ${fmtUsd(m.bestTrade, { sign: true })}`}
              tone="loss"
            />
          </div>

          {/* Equity curve */}
          <div className="card p-5">
            <SectionTitle title={t("dash.equity")} />
            <EquityChart data={m.equityCurve} />
          </div>

          {/* Daily pnl + heatmap */}
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="card p-5 min-w-0">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium text-sm">{t("dash.dailyPnl")}</h3>
                <div className="flex gap-1 text-xs">
                  {(["pnl", "winRate"] as const).map((mk) => (
                    <button
                      key={mk}
                      onClick={() => setDailyMetric(mk)}
                      className={`px-2.5 py-1 rounded-md transition ${
                        dailyMetric === mk ? "bg-accent/15 text-accent" : "text-muted hover:text-fg"
                      }`}
                    >
                      {mk === "pnl" ? t("metric.pnl") : t("metric.winRateShort")}
                    </button>
                  ))}
                </div>
              </div>
              <DailyPnlChart data={m.daily} metric={dailyMetric} />
            </div>
            <div className="card p-5 min-w-0">
              <SectionTitle title={t("dash.calendar")} />
              <PnlHeatmap daily={m.daily} />
              <div className="grid grid-cols-3 gap-2 mt-4">
                <MiniStat label={t("dash.bestDay")} value={fmtUsd(maxDaily(m.daily), { sign: true })} tone="profit" />
                <MiniStat label={t("dash.worstDay")} value={fmtUsd(minDaily(m.daily), { sign: true })} tone="loss" />
                <MiniStat label={t("dash.winningDays")} value={`${winningDays(m.daily)}/${m.daily.length}`} />
              </div>
            </div>
          </div>

          {/* Side + extras */}
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="card p-5">
              <SectionTitle
                title={<><Term name="Long">Long</Term> / <Term name="Short">Short</Term></>}
              />
              <div className="space-y-3">
                <SidePanel title={t("dash.long")} trades={m.bySide.long.trades} netPnl={m.bySide.long.netPnl} winRate={m.bySide.long.winRate} />
                <SidePanel title={t("dash.short")} trades={m.bySide.short.trades} netPnl={m.bySide.short.netPnl} winRate={m.bySide.short.winRate} />
              </div>
            </div>
            <div className="card p-5">
              <SectionTitle title={t("dash.indicators")} />
              <StatRow label={t("dash.avgWin")} value={fmtUsd(m.avgWin)} tone="profit" />
              <StatRow label={t("dash.avgLoss")} value={fmtUsd(-m.avgLoss)} tone="loss" />
              <StatRow label={t("dash.bestTrade")} value={fmtUsd(m.bestTrade, { sign: true })} tone="profit" />
              <StatRow label={t("dash.worstTrade")} value={fmtUsd(m.worstTrade, { sign: true })} tone="loss" />
              <StatRow label={t("dash.winStreak")} value={fmtNum(m.largestWinStreak, 0)} />
              <StatRow label={t("dash.lossStreak")} value={fmtNum(m.largestLossStreak, 0)} />
              <StatRow label={t("dash.avgHold")} value={fmtDuration(m.avgDurationMs)} />
            </div>
            <div className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium text-sm">{t("dash.byExchange")}</h3>
                <div className="flex gap-1 text-xs">
                  {(["netPnl", "winRate"] as const).map((mk) => (
                    <button
                      key={mk}
                      onClick={() => setExchangeMetric(mk)}
                      className={`px-2.5 py-1 rounded-md transition ${
                        exchangeMetric === mk ? "bg-accent/15 text-accent" : "text-muted hover:text-fg"
                      }`}
                    >
                      {mk === "netPnl" ? t("metric.pnl") : t("metric.winRateShort")}
                    </button>
                  ))}
                </div>
              </div>
              <BreakdownChart data={m.byExchange} metric={exchangeMetric} height={220} />
            </div>
          </div>

          {/* Entry analysis (ТВХ / тип входа) */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-sm">{t("dash.entryAnalysis")}</h3>
              <div className="flex gap-1 text-xs">
                {(["netPnl", "winRate"] as const).map((mk) => (
                  <button
                    key={mk}
                    onClick={() => setEntryMetric(mk)}
                    className={`px-2.5 py-1 rounded-md transition ${
                      entryMetric === mk ? "bg-accent/15 text-accent" : "text-muted hover:text-fg"
                    }`}
                  >
                    {mk === "netPnl" ? t("metric.pnl") : t("metric.winRateShort")}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              <div className="card p-5">
                <SectionTitle title={t("dash.byEntryPoint", { metric: entryMetricLabel })} />
                <BreakdownChart data={m.byEntryPoint} metric={entryMetric} />
              </div>
              <div className="card p-5">
                <SectionTitle title={t("dash.byEntryType", { metric: entryMetricLabel })} />
                <BreakdownChart data={m.byEntryType} metric={entryMetric} />
              </div>
            </div>
          </div>

          {/* Pattern analysis (паттерн) */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-sm">{t("dash.byPattern")}</h3>
              <div className="flex gap-1 text-xs">
                {(["netPnl", "winRate"] as const).map((mk) => (
                  <button
                    key={mk}
                    onClick={() => setPatternMetric(mk)}
                    className={`px-2.5 py-1 rounded-md transition ${
                      patternMetric === mk ? "bg-accent/15 text-accent" : "text-muted hover:text-fg"
                    }`}
                  >
                    {mk === "netPnl" ? t("metric.pnl") : t("metric.winRateShort")}
                  </button>
                ))}
              </div>
            </div>
            <BreakdownChart data={m.byPattern} metric={patternMetric} height={260} />
          </div>

          {/* Mistakes analysis */}
          <div className="card p-5">
            <SectionTitle title={t("dash.mistakeAnalysis")} />
            <BreakdownChart data={m.byMistake} height={260} />
          </div>

          {/* Trading-session breakdown (most relevant for forex) */}
          <div className="card p-5">
            <SectionTitle title={t("dash.bySession")} />
            <BreakdownChart data={m.bySession} height={240} />
          </div>

          {/* Time breakdown + symbols */}
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="card p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-medium text-sm">{t("dash.pnlByTime")}</h3>
                <div className="flex gap-1 text-xs">
                  {(["month", "dow", "hour"] as const).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setTimeTab(tab)}
                      className={`px-2.5 py-1 rounded-md transition ${
                        timeTab === tab ? "bg-accent/15 text-accent" : "text-muted hover:text-fg"
                      }`}
                    >
                      {tab === "month" ? t("dash.month") : tab === "dow" ? t("dash.dow") : t("dash.hour")}
                    </button>
                  ))}
                </div>
              </div>
              <BreakdownChart
                data={timeTab === "month" ? m.byMonth : timeTab === "dow" ? m.byDayOfWeek : m.byHour}
              />
            </div>
            <div className="card p-5">
              <SectionTitle title={t("dash.topSymbols")} />
              <SymbolTable rows={data.metrics.bySymbol.slice(0, 8)} />
            </div>
          </div>

          {/* Full statistics table */}
          <FullStats m={m} />
        </div>
      )}
    </div>
  );
}

function FullStats({ m }: { m: Metrics }) {
  const { t, locale } = useI18n();
  // The forex group only makes sense when there are imported (forex) trades.
  const hasForex =
    m.totalLots > 0 || m.totalPips !== 0 || m.totalSwap !== 0 || m.totalCommission > 0;
  const groups = METRIC_GROUPS.filter((g) => g.key !== "forex" || hasForex);
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-medium text-sm">{t("dash.fullStats")}</h3>
        <span className="text-xs text-faint">
          {TOTAL_METRICS} {locale === "en" ? "metrics" : "метрик"}
        </span>
      </div>
      <div className="grid gap-x-8 gap-y-6 md:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => (
          <div key={g.key}>
            <div className="text-xs uppercase tracking-wide text-faint mb-1.5">
              {t(`metricGroup.${g.key}`)}
            </div>
            <div>
              {g.items.map((it) => {
                const v = m[it.key] as number;
                const tone = metricTone(v, it.format);
                return (
                  <div
                    key={it.key}
                    className="flex items-center justify-between gap-3 py-1 text-sm border-b border-border/40 last:border-0"
                  >
                    <span className="text-muted">
                      <Term name={matchTerm(it.label)}>{t(`metric.${it.key}`)}</Term>
                    </span>
                    <span
                      className={`tabular-nums font-medium whitespace-nowrap ${
                        tone === "profit" ? "text-profit" : tone === "loss" ? "text-loss" : ""
                      }`}
                    >
                      {formatMetric(v, it.format, locale)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SectionTitle({ title }: { title: React.ReactNode }) {
  return <h3 className="font-medium text-sm mb-3">{title}</h3>;
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "profit" | "loss";
}) {
  return (
    <div className="rounded-lg bg-surface-2 px-3 py-2">
      <div className="text-xs text-faint">{label}</div>
      <div
        className={`text-sm font-medium tabular-nums ${
          tone === "profit" ? "text-profit" : tone === "loss" ? "text-loss" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function SidePanel({
  title,
  trades,
  netPnl,
  winRate,
}: {
  title: string;
  trades: number;
  netPnl: number;
  winRate: number;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-lg bg-surface-2 p-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium">{title}</span>
        <span className={`text-sm font-semibold tabular-nums ${netPnl >= 0 ? "text-profit" : "text-loss"}`}>
          {fmtUsd(netPnl, { sign: true })}
        </span>
      </div>
      <div className="text-xs text-faint">
        {t("dash.tradesCount", { n: trades, wr: winRate.toFixed(0) })}
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-border overflow-hidden">
        <div className="h-full bg-accent" style={{ width: `${Math.min(100, winRate)}%` }} />
      </div>
    </div>
  );
}

function SymbolTable({
  rows,
}: {
  rows: { symbol: string; trades: number; netPnl: number; winRate: number }[];
}) {
  const { t } = useI18n();
  if (rows.length === 0) return <div className="text-sm text-faint">{t("dash.noData")}</div>;
  return (
    <div className="space-y-1">
      {rows.map((r) => (
        <div
          key={r.symbol}
          className="flex items-center justify-between text-sm py-1.5 border-b border-border last:border-0"
        >
          <span className="font-medium">{fmtSymbol(r.symbol)}</span>
          <div className="flex items-center gap-4 text-xs text-faint">
            <span>{r.trades}</span>
            <span>{r.winRate.toFixed(0)}%</span>
            <span
              className={`font-medium tabular-nums w-20 text-right ${
                r.netPnl >= 0 ? "text-profit" : "text-loss"
              }`}
            >
              {fmtUsd(r.netPnl, { sign: true })}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  icon,
  title,
  text,
  actionHref,
  actionLabel,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  actionHref: string;
  actionLabel: string;
}) {
  return (
    <div className="card p-10 flex flex-col items-center text-center max-w-lg mx-auto mt-10">
      <div className="inline-flex h-14 w-14 items-center justify-center rounded-xl bg-accent/15 text-accent mb-4">
        {icon}
      </div>
      <h2 className="text-lg font-semibold mb-1">{title}</h2>
      <p className="text-sm text-muted mb-5">{text}</p>
      <Link
        href={actionHref}
        className="px-5 py-2.5 rounded-lg bg-accent text-white font-medium hover:bg-accent/90 transition"
      >
        {actionLabel}
      </Link>
    </div>
  );
}

function maxDaily(daily: { pnl: number }[]): number {
  return daily.length ? Math.max(...daily.map((d) => d.pnl)) : 0;
}
function minDaily(daily: { pnl: number }[]): number {
  return daily.length ? Math.min(...daily.map((d) => d.pnl)) : 0;
}
function winningDays(daily: { pnl: number }[]): number {
  return daily.filter((d) => d.pnl > 0).length;
}
