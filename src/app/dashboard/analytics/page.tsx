"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { StatsResponse, SerializedTrade } from "@/lib/types";
import { useI18n } from "@/lib/i18n/provider";
import { EquityChart, DrawdownChart, Histogram } from "@/components/charts.lazy";
import { Term } from "@/components/Term";
import { fmtRatio } from "@/lib/format";

type Bin = { label: string; count: number; tone?: "profit" | "loss" | "neutral" };

function compact(n: number): string {
  const a = Math.abs(n);
  const s = n < 0 ? "-" : "";
  if (a >= 1000) return `${s}${(a / 1000).toFixed(1)}k`;
  return `${s}${Math.round(a)}`;
}

function rrOf(tr: SerializedTrade): number | null {
  if (tr.stopLoss == null) return null;
  const risk = Math.abs(tr.entryPrice - tr.stopLoss);
  if (risk <= 0) return null;
  const move = tr.side === "long" ? tr.exitPrice - tr.entryPrice : tr.entryPrice - tr.exitPrice;
  return move / risk;
}

export default function AnalyticsPage() {
  const { t } = useI18n();
  const [data, setData] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [accountId, setAccountId] = useState("all");
  const [accountsBal, setAccountsBal] = useState<{ id: string; capital: number | null }[]>([]);

  // Стартовый капитал кривой капитала — как на дашборде: для конкретного счёта
  // его заданный капитал, для «Все аккаунты» — сумма заданных капиталов.
  const capital = useMemo(() => {
    if (accountId !== "all") {
      const a = accountsBal.find((x) => x.id === accountId);
      return a?.capital && a.capital > 0 ? a.capital : 10000;
    }
    const set = accountsBal.filter((a) => a.capital != null && a.capital > 0);
    return set.length ? set.reduce((s, a) => s + (a.capital ?? 0), 0) : 10000;
  }, [accountsBal, accountId]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      accountId,
      initialCapital: String(capital),
    });
    const res = await fetch(`/api/stats?${params}`);
    if (res.ok) setData(await res.json());
    setLoading(false);
  }, [accountId, capital]);
  useEffect(() => {
    load();
  }, [load]);

  // Загружаем заданный пользователем капитал по каждому счёту (как на дашборде).
  useEffect(() => {
    (async () => {
      const res = await fetch("/api/accounts");
      if (res.ok) {
        const accs = (await res.json()) as { id: string; capital: number | null }[];
        setAccountsBal(accs.map((a) => ({ id: a.id, capital: a.capital ?? null })));
      }
    })();
  }, []);

  const m = data?.metrics;
  const trades = data?.trades ?? [];

  const pnlBins = useMemo<Bin[]>(() => {
    const vals = trades.map((t) => t.netPnl);
    if (!vals.length) return [];
    const min = Math.min(...vals);
    const max = Math.max(...vals);
    const n = 9;
    const step = (max - min) / n || 1;
    const bins = Array.from({ length: n }, (_, i) => ({ lo: min + i * step, count: 0 }));
    for (const v of vals) {
      const idx = Math.min(n - 1, Math.max(0, Math.floor((v - min) / step)));
      bins[idx].count++;
    }
    return bins.map((b) => ({
      label: compact(b.lo),
      count: b.count,
      tone: (b.lo + step / 2 >= 0 ? "profit" : "loss") as "profit" | "loss",
    }));
  }, [trades]);

  const rBins = useMemo<Bin[]>(() => {
    const rs = trades.map(rrOf).filter((r): r is number => r != null);
    if (!rs.length) return [];
    const defs: { label: string; test: (r: number) => boolean; tone: "profit" | "loss" }[] = [
      { label: "≤ -2R", test: (r) => r <= -2, tone: "loss" },
      { label: "-2…-1", test: (r) => r > -2 && r < -1, tone: "loss" },
      { label: "-1…0", test: (r) => r >= -1 && r < 0, tone: "loss" },
      { label: "0…1", test: (r) => r >= 0 && r < 1, tone: "profit" },
      { label: "1…2", test: (r) => r >= 1 && r < 2, tone: "profit" },
      { label: "2…3", test: (r) => r >= 2 && r < 3, tone: "profit" },
      { label: "≥ 3R", test: (r) => r >= 3, tone: "profit" },
    ];
    return defs.map((d) => ({ label: d.label, count: rs.filter(d.test).length, tone: d.tone }));
  }, [trades]);

  const holdBins = useMemo<Bin[]>(() => {
    if (!trades.length) return [];
    const H = 3600_000;
    const defs: { label: string; test: (ms: number) => boolean }[] = [
      { label: "< 1h", test: (ms) => ms < H },
      { label: "1–4h", test: (ms) => ms >= H && ms < 4 * H },
      { label: "4–12h", test: (ms) => ms >= 4 * H && ms < 12 * H },
      { label: "12–24h", test: (ms) => ms >= 12 * H && ms < 24 * H },
      { label: "1–3d", test: (ms) => ms >= 24 * H && ms < 72 * H },
      { label: "> 3d", test: (ms) => ms >= 72 * H },
    ];
    return defs.map((d) => ({
      label: d.label,
      count: trades.filter((t) => d.test(t.durationMs)).length,
      tone: "neutral" as const,
    }));
  }, [trades]);

  const ratios = m
    ? [
        { k: "metric.sharpe", term: "Sharpe", v: fmtRatio(m.sharpe) },
        { k: "metric.sortino", term: "Sortino", v: fmtRatio(m.sortino) },
        { k: "metric.calmar", term: "Calmar", v: fmtRatio(m.calmar) },
        { k: "metric.profitFactor", term: "Profit Factor", v: fmtRatio(m.profitFactor) },
        { k: "metric.avgRR", term: "RR", v: `${m.avgRR >= 0 ? "+" : ""}${m.avgRR.toFixed(2)}R` },
        { k: "metric.recoveryFactor", term: "Recovery Factor", v: fmtRatio(m.recoveryFactor) },
      ]
    : [];

  return (
    <div className="px-6 py-5 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-semibold">{t("an.title")}</h1>
          <p className="text-sm text-muted">{t("an.subtitle")}</p>
        </div>
        <select
          className="input-base text-sm py-1.5 cursor-pointer"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          <option value="all">{t("dash.allAccounts")}</option>
          {data?.accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label} ({a.exchange})
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="text-sm text-faint">{t("common.loading")}</div>
      ) : !m || m.tradeCount === 0 ? (
        <div className="card p-10 text-center text-muted">{t("dash.empty.noTradesText")}</div>
      ) : (
        <div className="space-y-5">
          {/* Risk-adjusted ratios */}
          <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
            {ratios.map((r) => (
              <div key={r.k} className="card p-4">
                <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted mb-1.5">
                  <Term name={r.term}>{t(r.k)}</Term>
                </div>
                <div className="text-xl font-semibold tracking-tight tabular-nums">{r.v}</div>
              </div>
            ))}
          </div>

          <div className="card p-5">
            <h3 className="font-medium text-sm mb-3">
              <Term name="Equity">{t("an.equity")}</Term>
            </h3>
            <EquityChart data={m.equityCurve} />
          </div>

          <div className="card p-5">
            <h3 className="font-medium text-sm mb-3">
              <Term name="Drawdown">{t("an.drawdown")}</Term>
            </h3>
            <DrawdownChart data={m.equityCurve} />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="card p-5">
              <h3 className="font-medium text-sm mb-3">
                <Term name="P&L">{t("an.pnlDist")}</Term>
              </h3>
              <Histogram data={pnlBins} />
            </div>
            <div className="card p-5">
              <h3 className="font-medium text-sm mb-3">
                <Term name="RR">{t("an.rDist")}</Term>
              </h3>
              <Histogram data={rBins} />
            </div>
          </div>

          <div className="card p-5">
            <h3 className="font-medium text-sm mb-3">
              <Term desc={t("an.holdDistHint")}>{t("an.holdDist")}</Term>
            </h3>
            <Histogram data={holdBins} height={220} />
          </div>
        </div>
      )}
    </div>
  );
}
