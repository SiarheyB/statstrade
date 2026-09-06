"use client";

// Панель рынков: что уже открыто и что открывает следующая ступень.
//
// Раньше разблокировка рынков была невидимой — награда за испытание молча
// добавляла инструменты в список. Игрок не знал ни что его ждёт, ни ради
// чего терпеть лимит просадки.
import { Lock, Unlock } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { CONTRACTS } from "@/engine/player/contracts";
import type { AssetClass } from "@/engine/entities/types";

// Порядок — от простого рынка к сложному, он же порядок открытия.
const MARKETS: AssetClass[] = ["stock", "bond", "crypto", "forex", "commodity", "index"];

export default function MarketsPanel({
  unlocked,
  assetCounts,
}: {
  unlocked: AssetClass[];
  assetCounts: Record<string, number>;
}) {
  const { t } = useI18n();

  // Какой контракт открывает рынок — вытаскиваем из наград, чтобы не держать
  // вторую копию этой связи в UI.
  const unlockedBy = new Map<string, string>();
  for (const contract of CONTRACTS) {
    for (const market of contract.reward.unlockMarkets) unlockedBy.set(market, contract.id);
  }

  return (
    <div className="card p-4 space-y-3">
      <div>
        <div className="text-sm font-medium">{t("game.market.title")}</div>
        <div className="text-xs text-faint">{t("game.market.hint")}</div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {MARKETS.map((market) => {
          const isOpen = unlocked.includes(market) || market === "bond";
          const contractId = unlockedBy.get(market);
          return (
            <div
              key={market}
              className={`rounded-lg border p-3 ${isOpen ? "border-accent/40 bg-accent/5" : "border-border opacity-70"}`}
            >
              <div className="flex items-center gap-2">
                {isOpen ? <Unlock size={13} className="text-accent" /> : <Lock size={13} className="text-faint" />}
                <span className="text-sm font-medium">{t(`game.market.${market}`)}</span>
                <span className="ml-auto text-xs text-faint tabular-nums">{assetCounts[market] ?? 0}</span>
              </div>
              <div className="mt-1 text-[11px] text-faint">
                {isOpen
                  ? t("game.market.open")
                  : contractId
                    ? t("game.market.unlockedBy", { contract: t(`game.contract.${contractId}.name`) })
                    : t("game.market.locked")}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
