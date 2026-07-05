"use client";

import { useEffect, useMemo, useState } from "react";
import { Dices } from "lucide-react";
import type { SerializedTrade, AccountSummary } from "@/lib/types";
import { useI18n } from "@/lib/i18n/provider";
import { Term } from "@/components/Term";
import { fmtPct } from "@/lib/format";
import { runMonteCarlo, type MonteCarloResult } from "@/lib/analytics/monteCarlo";
import { scopeLabel } from "@/lib/analytics/scopeLabel";

type FeatureValue = {
  enabled: boolean;
  simulations: number;
  projectedTrades: number;
  ruinDrawdownPct: number;
};

// On-demand (button), same reasoning as ExitEfficiencyCard: a big
// simulations × projectedTrades product is real CPU work, don't run it
// silently on every page load. Hidden entirely if disabled in /admin/features.
export function MonteCarloCard({
  trades,
  capital,
  accounts,
}: {
  trades: SerializedTrade[];
  capital: number;
  accounts: AccountSummary[];
}) {
  const { t } = useI18n();
  const [feature, setFeature] = useState<FeatureValue | null>(null);
  const [result, setResult] = useState<MonteCarloResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/features?key=monteCarlo")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j) setFeature(j.value);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const scope = useMemo(() => scopeLabel(trades, accounts), [trades, accounts]);

  if (!feature || !feature.enabled || trades.length < 5 || capital <= 0) return null;

  function run() {
    setBusy(true);
    setResult(null);
    // Дать React отрисовать "busy" до тяжёлого синхронного расчёта.
    setTimeout(() => {
      const returnsPct = trades.map((tr) => tr.netPnl / capital);
      setResult(runMonteCarlo(returnsPct, feature!));
      setBusy(false);
    }, 30);
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-medium text-sm flex items-center gap-1.5">
          <Dices size={15} className="text-accent" />
          <Term desc={t("an.monteCarloHint")}>{t("an.monteCarlo")}</Term>
        </h3>
        <button
          onClick={run}
          disabled={busy}
          title={t("an.monteCarloRunHint", { sims: feature.simulations, steps: feature.projectedTrades })}
          className="input-base text-xs py-1.5 px-3 hover:border-border-strong disabled:opacity-50"
        >
          {busy ? t("common.loading") : t("an.monteCarloRun")}
        </button>
      </div>
      <p className="text-xs text-faint mt-1">
        {t("an.monteCarloIntro", { sims: feature.simulations, steps: feature.projectedTrades })}
      </p>
      {scope && (
        <p className="text-xs text-faint mt-1">
          <Term desc={t("an.scopeHintAll")}>{t("an.scopeLabel")}</Term>: {scope}
        </p>
      )}

      {result && (
        <div className="mt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat
              label={<Term desc={t("an.riskOfRuinHint", { pct: feature.ruinDrawdownPct })}>{t("an.riskOfRuin")}</Term>}
              value={`${result.riskOfRuinPct.toFixed(1)}%`}
              tone={result.riskOfRuinPct >= 20 ? "loss" : "profit"}
            />
            <Stat
              label={<Term desc={t("an.mcP5Hint")}>{t("an.mcP5")}</Term>}
              value={fmtPct((result.p5 - 1) * 100, 0)}
              tone="loss"
            />
            <Stat
              label={<Term desc={t("an.mcP50Hint")}>{t("an.mcP50")}</Term>}
              value={fmtPct((result.p50 - 1) * 100, 0)}
              tone={result.p50 >= 1 ? "profit" : "loss"}
            />
            <Stat
              label={<Term desc={t("an.mcP95Hint")}>{t("an.mcP95")}</Term>}
              value={fmtPct((result.p95 - 1) * 100, 0)}
              tone="profit"
            />
          </div>
          <p className="mt-3 text-xs text-faint">
            {t("an.monteCarloNote", { sims: result.simulations, steps: result.projectedTrades })}
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: React.ReactNode; value: string; tone: "profit" | "loss" }) {
  return (
    <div>
      <div className="text-xs text-faint">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${tone === "profit" ? "text-profit" : "text-loss"}`}>
        {value}
      </div>
    </div>
  );
}
