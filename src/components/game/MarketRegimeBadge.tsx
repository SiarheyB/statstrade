"use client";

// Индикатор рыночного режима (раздел 3.4). Режим меняет μ и σ ВСЕМ активам
// сразу, то есть объясняет, почему «сегодня всё растёт» или «всё сыпется»,
// — без него это выглядело бы как случайная полоса везения.
import { useI18n } from "@/lib/i18n/provider";
import type { MarketRegime, MarketRegimeType } from "@/engine/entities/types";

const REGIME_STYLE: Record<MarketRegimeType, string> = {
  bull: "bg-profit/15 text-profit",
  bear: "bg-loss/15 text-loss",
  sideways: "bg-surface-2 text-muted",
  high_volatility: "bg-accent/15 text-accent",
  crisis: "bg-loss text-white",
};

export default function MarketRegimeBadge({ regime }: { regime: MarketRegime }) {
  const { t } = useI18n();
  return (
    <div
      className={`px-3 py-1.5 rounded-lg text-sm font-medium ${REGIME_STYLE[regime.type]}`}
      title={t("game.regime.hint", { days: Math.floor(regime.daysInRegime) })}
    >
      {t(`game.regime.${regime.type}`)}
      <span className="ml-2 text-xs opacity-70 tabular-nums">{Math.floor(regime.daysInRegime)}{t("game.regime.daysShort")}</span>
    </div>
  );
}
