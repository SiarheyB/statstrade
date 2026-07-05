"use client";

import { useEffect, useState } from "react";
import { TrendingUp } from "lucide-react";
import type { SerializedTrade } from "@/lib/types";
import { useI18n } from "@/lib/i18n/provider";
import { Term } from "@/components/Term";
import { fmtPct, fmtUsd, fmtSymbol } from "@/lib/format";
import { computeExitEfficiency, type ExitEfficiencySummary } from "@/lib/analytics/exitEfficiency";

type FeatureValue = { enabled: boolean; maxTrades: number; concurrency: number };

// On-demand only (button, not auto-run on page load) — this fetches public
// OHLC per trade from the exchange, which is too expensive to run silently
// every time someone opens Analytics. Hidden entirely if the admin disabled
// the feature in /admin/features.
export function ExitEfficiencyCard({ trades }: { trades: SerializedTrade[] }) {
  const { t } = useI18n();
  const [feature, setFeature] = useState<FeatureValue | null>(null);
  const [summary, setSummary] = useState<ExitEfficiencySummary | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/features?key=exitEfficiency")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (alive && j) setFeature(j.value);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!feature || !feature.enabled || trades.length === 0) return null;

  async function run() {
    setBusy(true);
    setSummary(null);
    try {
      setSummary(await computeExitEfficiency(trades, feature!));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-medium text-sm flex items-center gap-1.5">
          <TrendingUp size={15} className="text-accent" />
          <Term name="MFE" desc={t("an.exitEfficiencyHint")}>
            {t("an.exitEfficiency")}
          </Term>
        </h3>
        <button
          onClick={run}
          disabled={busy}
          className="input-base text-xs py-1.5 px-3 hover:border-border-strong disabled:opacity-50"
        >
          {busy ? t("common.loading") : t("an.exitEfficiencyRun")}
        </button>
      </div>

      {summary && (
        <div className="mt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label={t("trades.chart.mfe")} value={fmtPct(summary.avgMfePct)} tone="profit" />
            <Stat label={t("trades.chart.mae")} value={fmtPct(summary.avgMaePct)} tone="loss" />
            <Stat
              label={t("trades.chart.captured")}
              value={fmtPct(summary.avgCapturedPct, 0)}
              tone={summary.avgCapturedPct >= 0 ? "profit" : "loss"}
            />
            <Stat label={t("an.leftOnTable")} value={fmtUsd(summary.leftOnTableUsd)} tone="loss" />
          </div>
          <p className="mt-3 text-xs text-faint">
            {t("an.exitEfficiencyAnalyzed", { n: summary.analyzed, skipped: summary.skipped })}
          </p>
          {summary.worst.length > 0 && (
            <div className="mt-3 space-y-1">
              <div className="text-xs text-faint">{t("an.exitEfficiencyWorst")}</div>
              {summary.worst.map(({ trade, capturedPct }) => (
                <div key={trade.id} className="flex items-center justify-between text-xs">
                  <span>{fmtSymbol(trade.symbol)}</span>
                  <span className={capturedPct >= 0 ? "text-profit" : "text-loss"}>{fmtPct(capturedPct, 0)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "profit" | "loss" }) {
  return (
    <div>
      <div className="text-xs text-faint">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${tone === "profit" ? "text-profit" : "text-loss"}`}>
        {value}
      </div>
    </div>
  );
}
