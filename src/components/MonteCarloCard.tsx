"use client";

import { useEffect, useState } from "react";
import { Dices } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { Term } from "@/components/Term";
import { fmtPct } from "@/lib/format";
import { runMonteCarlo, type MonteCarloResult } from "@/lib/analytics/monteCarlo";

type FeatureValue = {
  enabled: boolean;
  simulations: number;
  projectedTrades: number;
  ruinDrawdownPct: number;
};

// On-demand (button), same reasoning as ExitEfficiencyCard: a big
// simulations × projectedTrades product is real CPU work, don't run it
// silently on every page load. Hidden entirely if disabled in /admin/features.
export function MonteCarloCard({ netPnls, capital }: { netPnls: number[]; capital: number }) {
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

  if (!feature || !feature.enabled || netPnls.length < 5 || capital <= 0) return null;

  function run() {
    setBusy(true);
    setResult(null);
    // Дать React отрисовать "busy" до тяжёлого синхронного расчёта.
    setTimeout(() => {
      const returnsPct = netPnls.map((p) => p / capital);
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
          className="input-base text-xs py-1.5 px-3 hover:border-border-strong disabled:opacity-50"
        >
          {busy ? t("common.loading") : t("an.monteCarloRun")}
        </button>
      </div>

      {result && (
        <div className="mt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat
              label={<Term desc={t("an.riskOfRuinHint")}>{t("an.riskOfRuin")}</Term>}
              value={`${result.riskOfRuinPct.toFixed(1)}%`}
              tone={result.riskOfRuinPct >= 20 ? "loss" : "profit"}
            />
            <Stat label={t("an.mcP5")} value={fmtPct((result.p5 - 1) * 100, 0)} tone="loss" />
            <Stat label={t("an.mcP50")} value={fmtPct((result.p50 - 1) * 100, 0)} tone={result.p50 >= 1 ? "profit" : "loss"} />
            <Stat label={t("an.mcP95")} value={fmtPct((result.p95 - 1) * 100, 0)} tone="profit" />
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
