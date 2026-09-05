"use client";

// Вкладка «Карьера» — единственное место, где игрок видит СЕБЯ, а не рынок:
// уровни по каждому стилю торговли, ранг и престиж, купленное имущество,
// сводка результатов.
//
// Зачем отдельно: прогресс — главный мотиватор в любой игре, но до этого он
// был размазан по терминалу (уровень в углу, покупки внутри магазина,
// метрики под журналом) и не читался как «мой путь».
import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { fmtUsd } from "@/lib/format";
import { xpToNextLevel, MAX_SKILL_LEVEL } from "@/engine/player/progression";
import { calculatePortfolioMetrics } from "@/engine/player/portfolioMetrics";
import { getShopItem, monthlyUpkeep, nextRank, restFactor, traderRankKey } from "@/engine/economy/shop";
import { toolSubscriptionCost } from "@/engine/economy/taxes";
import { HintLabel } from "./Hint";
import type { TaxState } from "@/engine/entities/types";
import { stressLevel } from "@/engine/player/psychology";
import { SELECTABLE_STYLES } from "@/store/gameStore";
import { useGameStore } from "@/store/gameStore";
import type { Account, LifestyleState, TradingStyle } from "@/engine/entities/types";

const STYLE_LABEL_KEY: Record<string, string> = {
  scalping: "game.style.scalping",
  day: "game.style.day",
  swing: "game.style.swing",
  investing: "game.style.investing",
};

export default function CareerPanel({
  account,
  lifestyle,
  startingBalance,
  tax,
  tools,
}: {
  account: Account;
  lifestyle: LifestyleState;
  startingBalance: number;
  tax: TaxState;
  tools: { orderBookAnywhere: boolean; screener: boolean; newsRadar: boolean };
}) {
  const { t } = useI18n();
  const resetProgress = useGameStore((s) => s.resetProgress);
  // Подтверждение прямо в кнопке, а не в window.confirm: браузерный диалог
  // блокирует вкладку, а игра в это время тикает.
  const [confirming, setConfirming] = useState(false);
  const rankKey = traderRankKey(account.reputation);
  const next = nextRank(account.reputation);
  const metrics = calculatePortfolioMetrics(account.journal, startingBalance);
  const closed = account.positions.filter((p) => p.closedAt != null);
  // Содержание вещей и абонплата за инструменты списываются одним платежом
  // раз в игровой месяц — показываем их так же, одной цифрой.
  const monthly = monthlyUpkeep(lifestyle) + toolSubscriptionCost(tools);
  const owned = lifestyle.ownedItemIds.map((id) => getShopItem(id)).filter((i) => i != null);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="card p-4 space-y-4">
        <div>
          <div className="text-sm font-medium">{t("game.career.rank")}</div>
          <div className="mt-1 text-2xl font-semibold text-accent">{t(`game.shop.rank.${rankKey}`)}</div>
          <div className="text-xs text-faint">
            {t("game.shop.prestige")}: {account.reputation}
            {next && ` · ${t("game.shop.rankNext", { rank: t(`game.shop.rank.${next.key}`), prestige: next.remaining })}`}
          </div>
        </div>

        <div className="space-y-3">
          <div className="text-sm font-medium">{t("game.career.skills")}</div>
          {SELECTABLE_STYLES.map((style: TradingStyle) => {
            const skill = account.skills[style] ?? { level: 0, xp: 0, xpToNextLevel: xpToNextLevel(0) };
            const pct = skill.level >= MAX_SKILL_LEVEL ? 100 : Math.min(100, (skill.xp / (skill.xpToNextLevel || 1)) * 100);
            return (
              <div key={style}>
                <div className="flex items-baseline justify-between text-xs">
                  <span>{t(STYLE_LABEL_KEY[style])}</span>
                  <span className="text-faint tabular-nums">
                    {t("game.skill.level", { level: skill.level })} · {Math.round(skill.xp)}/{skill.xpToNextLevel}
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full rounded-full bg-surface-2 overflow-hidden">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card p-4 space-y-4">
        <div className="text-sm font-medium">{t("game.career.results")}</div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <div className="text-[11px] text-muted">{t("game.career.tradesClosed")}</div>
            <div className="tabular-nums font-medium">{metrics.totalTrades || closed.length}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted">{t("game.journal.winRate")}</div>
            <div className="tabular-nums font-medium">
              {metrics.winRate == null ? "—" : `${(metrics.winRate * 100).toFixed(0)}%`}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-muted">{t("game.journal.avgR")}</div>
            <div className="tabular-nums font-medium">
              {metrics.avgRMultiple == null ? "—" : metrics.avgRMultiple.toFixed(2)}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-muted">{t("game.journal.maxDrawdown")}</div>
            <div className="tabular-nums font-medium">
              {metrics.maxDrawdownPct == null ? "—" : `${metrics.maxDrawdownPct.toFixed(1)}%`}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-muted">{t("game.shop.spent")}</div>
            <div className="tabular-nums font-medium">{fmtUsd(lifestyle.totalSpent + lifestyle.totalUpkeepPaid)}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted">
              <HintLabel text={t("game.tip.upkeep")}>{t("game.shop.upkeepTotal")}</HintLabel>
            </div>
            <div className={`tabular-nums font-medium ${monthly > 0 ? "text-loss" : ""}`}>
              {monthly > 0 ? `−${fmtUsd(monthly)}` : fmtUsd(0)}
            </div>
          </div>
          {/* Налог показываем всегда, даже нулевой: списание, о котором игрок
              не знал, выглядит как пропажа денег, а не как правило игры. */}
          <div>
            <div className="text-[11px] text-muted">
              <HintLabel text={t("game.tip.tax")}>{t("game.career.taxPaid")}</HintLabel>
            </div>
            <div className={`tabular-nums font-medium ${tax.paidTotal > 0 ? "text-loss" : ""}`}>
              {tax.paidTotal > 0 ? `−${fmtUsd(tax.paidTotal)}` : fmtUsd(0)}
            </div>
            {tax.carriedLoss > 0 && (
              <div className="text-[11px] text-faint">{t("game.career.carriedLoss", { amount: fmtUsd(tax.carriedLoss) })}</div>
            )}
          </div>
        </div>

        <div>
          <div className="text-sm font-medium mb-1">{t("game.psy.title")}</div>
          <div className="space-y-2">
            {([
              ["stress", account.psychology.stress, stressLevel(account.psychology.stress) === "high" ? "bg-loss" : "bg-accent"],
              ["confidence", account.psychology.confidence, "bg-accent"],
              ["discipline", account.psychology.discipline, "bg-profit"],
            ] as const).map(([key, value, color]) => (
              <div key={key}>
                <div className="flex items-baseline justify-between text-xs">
                  <span className="text-muted">{t(`game.psy.${key}`)}</span>
                  <span className="tabular-nums text-faint">{Math.round(value)}</span>
                </div>
                <div className="mt-1 h-1.5 w-full rounded-full bg-surface-2 overflow-hidden">
                  <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, value)}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1.5 text-[11px] text-faint">
            {t("game.psy.hint", { rest: `${Math.round((restFactor(lifestyle) - 1) * 100)}%` })}
          </div>
        </div>

        <div>
          <div className="text-sm font-medium">{t("game.career.belongings")}</div>
          {owned.length === 0 ? (
            <div className="mt-1 text-xs text-faint">{t("game.career.nothingOwned")}</div>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              {owned.map((item) => (
                <span
                  key={item.id}
                  title={t(`game.shop.item.${item.id}.name`)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-surface-2 px-2 py-1 text-xs"
                >
                  <span>{item.icon}</span>
                  <span className="text-muted">{t(`game.shop.item.${item.id}.name`)}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="card p-4 lg:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">{t("game.career.reset")}</div>
            <div className="text-xs text-faint max-w-xl">{t("game.career.resetHint")}</div>
          </div>
          {confirming ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-loss">{t("game.career.resetConfirm")}</span>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  void resetProgress();
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-loss text-white"
              >
                {t("common.yes")}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="px-3 py-1.5 rounded-lg text-xs text-muted hover:text-fg"
              >
                {t("common.cancel")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-muted hover:text-loss transition"
            >
              <RotateCcw size={14} />
              {t("game.career.reset")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
