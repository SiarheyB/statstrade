"use client";

// Прогноз сложного процента — раздел 4.8 спеки, виден только в Investing-стиле
// (та самая "вложение средств" из запроса пользователя). Чисто
// информационный виджет: не влияет на реальную симуляцию, просто отвечает
// на вопрос "если ничего не менять, сколько будет через N лет" — тем же
// принципом, каким живые брокеры показывают калькулятор сложного процента.
import { useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { fmtUsd } from "@/lib/format";
import { calculateFutureValue } from "@/engine/economy/compoundGrowth";

export default function InvestingForecast({ principal, assetCount }: { principal: number; assetCount: number }) {
  const { t } = useI18n();
  const [annualReturnPct, setAnnualReturnPct] = useState(7);
  const [years, setYears] = useState(10);

  const futureValue = calculateFutureValue(principal, annualReturnPct / 100, years);

  return (
    <div className="card p-4 space-y-3 w-full">
      <div className="text-sm font-medium">{t("game.investing.title")}</div>
      <div className="text-xs text-faint">{t("game.investing.hint", { count: assetCount })}</div>

      <div className="text-xs text-faint flex items-center justify-between">
        <span>{t("game.investing.principal")}</span>
        <span className="text-fg tabular-nums font-medium">{fmtUsd(principal)}</span>
      </div>

      <div>
        <label className="text-xs text-faint flex items-center justify-between mb-1">
          <span>{t("game.investing.annualReturn")}</span>
          <span className="text-fg font-medium tabular-nums">{annualReturnPct}%</span>
        </label>
        <input
          type="range"
          min={-10}
          max={20}
          step={1}
          value={annualReturnPct}
          onChange={(e) => setAnnualReturnPct(Number(e.target.value))}
          className="w-full accent-accent"
        />
      </div>

      <div>
        <label className="text-xs text-faint flex items-center justify-between mb-1">
          <span>{t("game.investing.years")}</span>
          <span className="text-fg font-medium tabular-nums">{years}</span>
        </label>
        <input
          type="range"
          min={1}
          max={30}
          step={1}
          value={years}
          onChange={(e) => setYears(Number(e.target.value))}
          className="w-full accent-accent"
        />
      </div>

      <div className="text-xs text-faint flex items-center justify-between pt-1 border-t border-border">
        <span>{t("game.investing.futureValue")}</span>
        <span className={`tabular-nums font-semibold ${futureValue >= principal ? "text-profit" : "text-loss"}`}>
          {fmtUsd(futureValue)}
        </span>
      </div>

      <div className="text-[11px] text-faint">{t("game.investing.disclaimer")}</div>
    </div>
  );
}
