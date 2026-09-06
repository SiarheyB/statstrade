"use client";

// Индикатор рыночного режима (раздел 3.4). Режим меняет μ и σ ВСЕМ активам
// сразу, то есть объясняет, почему «сегодня всё растёт» или «всё сыпется»,
// — без него это выглядело бы как случайная полоса везения.
import { useI18n } from "@/lib/i18n/provider";
import type { MarketRegime, MarketRegimeType } from "@/engine/entities/types";
import Hint from "./Hint";

const REGIME_STYLE: Record<MarketRegimeType, string> = {
  bull: "bg-profit/15 text-profit",
  bear: "bg-loss/15 text-loss",
  sideways: "bg-surface-2 text-muted",
  high_volatility: "bg-accent/15 text-accent",
  crisis: "bg-loss text-white",
};

export default function MarketRegimeBadge({ regime }: { regime: MarketRegime }) {
  const { t } = useI18n();
  // Подсказка отвечает ровно на те вопросы, которые бейдж вызывал: что это
  // такое, каких инструментов касается и почему режим именно такой. Раньше
  // здесь стоял системный `title` — он появляется через секунду, и его никто
  // не находил, так что бейдж выглядел загадочной надписью в углу.
  // Снос описываем словами, а не процентами: driftModifier — МНОЖИТЕЛЬ, и
  // отрицательный переворачивает тренд. «−220%» из него получается
  // арифметически верное, но бессмысленное для человека число.
  const driftWord =
    regime.driftModifier < 0 ? "down" : regime.driftModifier < 1 ? "weaker" : regime.driftModifier > 1 ? "stronger" : "same";
  const vol = Math.round((regime.volModifier - 1) * 100);
  return (
    <Hint
      align="end"
      text={t("game.regime.explain", {
        regime: t(`game.regime.${regime.type}`).toLowerCase(),
        days: Math.floor(regime.daysInRegime),
        drift: t(`game.regime.drift.${driftWord}`),
        vol: `${vol >= 0 ? "+" : ""}${vol}`,
      })}
    >
      <div className={`px-3 py-1.5 rounded-lg text-sm font-medium cursor-help ${REGIME_STYLE[regime.type]}`}>
        {t(`game.regime.${regime.type}`)}
        <span className="ml-2 text-xs opacity-70 tabular-nums">
          {Math.floor(regime.daysInRegime)}
          {t("game.regime.daysShort")}
        </span>
      </div>
    </Hint>
  );
}
