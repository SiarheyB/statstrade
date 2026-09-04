"use client";

// «Куда вложены средства» — сводка портфеля по секторам/классам активов
// (раздел 8, Investing). В таблице позиций это не видно: там 30 строк с
// тикерами, а вопрос «не собрал ли я весь портфель в техах» требует
// агрегата. Свободные деньги показываются такой же долей, как акции —
// иначе портфель из одной покупки на 5% капитала выглядел бы как «100% в
// одном секторе».
//
// Расчёты — в engine/player/diversification.ts (раздел 17).
import { useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { fmtUsd } from "@/lib/format";
import {
  CASH_KEY,
  diversificationScore,
  investedShare,
  largestExposure,
  portfolioSlices,
  type BreakdownDimension,
} from "@/engine/player/diversification";
import type { Asset, Position } from "@/engine/entities/types";

// Палитра долей: фиксированный порядок, чтобы цвет сектора не прыгал между
// перерисовками (доли сортируются по величине, и при смене цен порядок
// меняется — цвет привязан к позиции в списке намеренно: важна читаемость
// полосы, а не постоянство цвета конкретного сектора).
const SLICE_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#ec4899", "#06b6d4", "#f97316", "#84cc16", "#eab308", "#14b8a6"];
const CASH_COLOR = "#4b5563";

function sliceColor(key: string, index: number): string {
  return key === CASH_KEY ? CASH_COLOR : SLICE_COLORS[index % SLICE_COLORS.length];
}

export default function DiversificationPanel({
  positions,
  assets,
  prices,
  cash,
}: {
  positions: Position[];
  assets: Asset[];
  prices: Record<string, number>;
  cash: number;
}) {
  const { t } = useI18n();
  const [dimension, setDimension] = useState<BreakdownDimension>("sector");

  const slices = portfolioSlices(positions, assets, prices, cash, dimension);
  const score = diversificationScore(slices);
  const largest = largestExposure(slices);
  const invested = investedShare(slices);

  function labelFor(key: string): string {
    if (key === CASH_KEY) return t("game.diversification.cash");
    return t(`game.${dimension === "sector" ? "sector" : "assetClass"}.${key}`);
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-medium">{t("game.diversification.title")}</div>
        <div className="flex items-center gap-1 rounded-lg bg-surface-2 p-0.5">
          {(["sector", "assetClass"] as BreakdownDimension[]).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDimension(d)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition ${
                dimension === d ? "bg-accent text-white" : "text-muted hover:text-fg"
              }`}
            >
              {t(`game.diversification.by.${d}`)}
            </button>
          ))}
        </div>
      </div>

      {slices.length === 0 ? (
        <div className="text-xs text-faint">{t("game.diversification.empty")}</div>
      ) : (
        <>
          <div className="flex h-3 w-full overflow-hidden rounded-full">
            {slices.map((s, i) => (
              <div
                key={s.key}
                title={`${labelFor(s.key)} — ${(s.weight * 100).toFixed(1)}%`}
                style={{ width: `${s.weight * 100}%`, backgroundColor: sliceColor(s.key, i) }}
              />
            ))}
          </div>

          <div className="space-y-1">
            {slices.map((s, i) => (
              <div key={s.key} className="flex items-center gap-2 text-xs">
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: sliceColor(s.key, i) }} />
                <span className="text-muted flex-1 truncate">{labelFor(s.key)}</span>
                <span className="tabular-nums text-faint">{fmtUsd(s.value)}</span>
                <span className="tabular-nums w-12 text-right">{(s.weight * 100).toFixed(1)}%</span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border text-xs">
            <div>
              <div className="text-faint">{t("game.diversification.score")}</div>
              <div className="tabular-nums font-medium">{score} / 100</div>
            </div>
            <div>
              <div className="text-faint">{t("game.diversification.invested")}</div>
              <div className="tabular-nums font-medium">{(invested * 100).toFixed(1)}%</div>
            </div>
          </div>

          {/* Подсказка, а не запрет: концентрированный портфель — законная
              стратегия, игре не место читать нотации. Порог 40% — обычная
              граница «крупной позиции» в риск-менеджменте. */}
          {largest && largest.weight > 0.4 && (
            <div className="text-[11px] text-faint">
              {t("game.diversification.concentrated", {
                key: labelFor(largest.key),
                pct: (largest.weight * 100).toFixed(0),
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
