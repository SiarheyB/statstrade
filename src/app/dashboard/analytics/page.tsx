"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { StatsResponse } from "@/lib/types";
import { useI18n } from "@/lib/i18n/provider";
import { EquityChart, DrawdownChart, Histogram } from "@/components/charts.lazy";
import { Term } from "@/components/Term";
import { ExitEfficiencyCard } from "@/components/ExitEfficiencyCard";
import { MonteCarloCard } from "@/components/MonteCarloCard";
import { fmtRatio } from "@/lib/format";

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
              <Histogram data={m.pnlBins} />
            </div>
            <div className="card p-5">
              <h3 className="font-medium text-sm mb-3">
                <Term name="RR">{t("an.rDist")}</Term>
              </h3>
              <Histogram data={m.rBins} />
            </div>
          </div>

          <div className="card p-5">
            <h3 className="font-medium text-sm mb-3">
              <Term desc={t("an.holdDistHint")}>{t("an.holdDist")}</Term>
            </h3>
            <Histogram data={m.holdBins} height={220} />
          </div>

          {/* Обе карточки теперь получают ГОТОВЫЙ результат с сервера:
              MFE/MAE лежат в БД, Monte Carlo считается в /api/monte-carlo.
              Массив сделок им больше не нужен — только область расчёта. */}
          <ExitEfficiencyCard scope={m.scopeAccounts} accounts={data?.accounts ?? []} />
          <MonteCarloCard
            scope={m.scopeAccounts}
            accounts={data?.accounts ?? []}
            accountId={accountId}
            capital={capital}
            tradeCount={m.tradeCount}
          />
        </div>
      )}
    </div>
  );
}
