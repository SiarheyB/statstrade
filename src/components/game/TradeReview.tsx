"use client";

// Разбор сделок: что именно мешает счёту расти.
//
// Отчёт «винрейт 46%, средний R 0.2» игрок читает и закрывает — из него не
// следует, что делать завтра. Фраза «убыток вы держите в 3.4 раза дольше
// прибыли» следует. Поэтому здесь не метрики, а замечания на человеческом
// языке, и каждое опирается на его собственные сделки.
import { useMemo } from "react";
import { AlertTriangle, Info, Sparkles } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { diagnose, MIN_TRADES } from "@/engine/player/diagnostics";
import type { JournalEntry, Position } from "@/engine/entities/types";

const ICON = { warn: AlertTriangle, info: Info, good: Sparkles } as const;
const TONE = { warn: "text-loss", info: "text-muted", good: "text-profit" } as const;

export default function TradeReview({ positions, journal }: { positions: Position[]; journal: JournalEntry[] }) {
  const { t } = useI18n();
  const insights = useMemo(() => diagnose(positions, journal), [positions, journal]);
  const closed = positions.filter((p) => p.closedAt != null).length;

  return (
    <div className="card p-4 space-y-3">
      <div>
        <div className="text-sm font-medium">{t("game.review.title")}</div>
        <div className="text-xs text-faint mt-0.5">{t("game.review.subtitle")}</div>
      </div>

      {closed < MIN_TRADES ? (
        // Молчание здесь честнее выдуманного совета: вывод по трём сделкам —
        // это шум, и один такой совет убивает доверие ко всем остальным.
        <div className="text-sm text-faint">{t("game.review.needMore", { left: MIN_TRADES - closed })}</div>
      ) : insights.length === 0 ? (
        <div className="text-sm text-profit">{t("game.review.clean")}</div>
      ) : (
        <ul className="space-y-2.5">
          {insights.map((insight) => {
            const Icon = ICON[insight.tone];
            const values =
              insight.id === "bestStyle" || insight.id === "worstStyle"
                ? { ...insight.values, style: t(`game.style.${insight.values.style}`) }
                : insight.values;
            return (
              <li key={insight.id} className="flex gap-2.5 text-sm leading-relaxed">
                <Icon size={15} className={`${TONE[insight.tone]} mt-0.5 shrink-0`} />
                <div>
                  <span>{t(`game.insight.${insight.id}`, values)}</span>
                  <div className="text-xs text-faint mt-0.5">{t(`game.insight.${insight.id}.fix`)}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
