"use client";

// Алго-боты: настройка стратегий, которые торгуют сами. Слоты открываются
// перками ветки «Автоматика» — до первого перка панель объясняет, что нужно
// сделать, а не просто пустует.
//
// Слот из перка даёт ПРАВО завести бота, а не самого бота: сам автомат —
// платная лицензия (BOT_LICENSE_PRICE), а не бесплатный довеском к прокачке.
// Готовые пакеты (BOT_PACKAGES) — это не витрина одинаковых карточек: у
// каждого своя стратегия и свой риск, и КАЖДЫЙ может проиграть — сигналы
// считаются по тем же свечам, что видит игрок, без знания будущего.
import { useState } from "react";
import { Bot, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { fmtUsd } from "@/lib/format";
import { useGameStore } from "@/store/gameStore";
import { botSlots, botRecord, BOT_LICENSE_PRICE, BOT_PACKAGES, type AlgoBot, type BotStrategy } from "@/engine/player/algoBots";
import type { Asset, PerkState, Position } from "@/engine/entities/types";
import { HintLabel } from "./Hint";

const STRATEGIES: BotStrategy[] = ["trend", "meanReversion", "breakout"];

function NumberField({
  label,
  value,
  onChange,
  step = 0.5,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <label className="text-[11px] text-muted">
      {label}
      <input
        type="number"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="input-base mt-0.5 block w-20 px-2 py-1 text-sm tabular-nums"
      />
    </label>
  );
}

/** Итоги закрытых сделок бота — то, ради чего вообще стоит смотреть на панель. */
function BotStats({ positions, botId }: { positions: Position[]; botId: string }) {
  const { t } = useI18n();
  const stats = botRecord(positions, botId);
  if (stats.trades === 0) {
    return <div className="text-[11px] text-faint">{t("game.bots.noTradesYet")}</div>;
  }
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted">
      <span>{t("game.bots.stat.trades", { count: stats.trades })}</span>
      <span className={stats.winRate >= 0.5 ? "text-profit" : "text-loss"}>
        {t("game.bots.stat.winRate", { pct: Math.round(stats.winRate * 100) })}
      </span>
      <span className={stats.totalPnl >= 0 ? "text-profit" : "text-loss"}>
        {t("game.bots.stat.pnl", { amount: fmtUsd(stats.totalPnl) })}
      </span>
    </div>
  );
}

export default function BotsPanel({
  bots,
  perks,
  assets,
}: {
  bots: AlgoBot[];
  perks: PerkState;
  assets: Asset[];
}) {
  const { t } = useI18n();
  const addBot = useGameStore((s) => s.addBot);
  const buyBotPackage = useGameStore((s) => s.buyBotPackage);
  const updateBot = useGameStore((s) => s.updateBot);
  const removeBot = useGameStore((s) => s.removeBot);
  const balance = useGameStore((s) => s.game.account.balance);
  const positions = useGameStore((s) => s.game.account.positions);
  const [pickAssetFor, setPickAssetFor] = useState<string | null>(null);

  const slots = botSlots(perks.unlocked);
  const canAfford = balance >= BOT_LICENSE_PRICE;
  const hasFreeSlot = bots.length < slots && assets.length > 0;

  return (
    <div className="card p-4 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-sm font-medium inline-flex items-center gap-1.5">
            <Bot size={15} />
            {t("game.bots.title")}
          </div>
          <div className="text-xs text-faint">{t("game.bots.hint")}</div>
        </div>
        <div className="text-xs text-muted tabular-nums">
          {t("game.bots.slots", { used: bots.length, total: slots })}
        </div>
      </div>

      {slots === 0 ? (
        <div className="text-xs text-faint">{t("game.bots.locked")}</div>
      ) : (
        <>
          {bots.slice(0, slots).map((bot) => (
            <div key={bot.id} className="rounded-lg border border-border p-3 space-y-2">
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-[11px] text-muted">
                  {t("game.order.asset")}
                  <select
                    value={bot.assetId}
                    onChange={(e) => updateBot(bot.id, { assetId: e.target.value })}
                    className="input-base mt-0.5 block w-40 px-2 py-1 text-sm"
                  >
                    {assets.map((asset) => (
                      <option key={asset.id} value={asset.id}>
                        {asset.symbol}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-[11px] text-muted">
                  {t("game.bots.strategy")}
                  <select
                    value={bot.strategy}
                    onChange={(e) => updateBot(bot.id, { strategy: e.target.value as BotStrategy })}
                    className="input-base mt-0.5 block w-44 px-2 py-1 text-sm"
                  >
                    {STRATEGIES.map((strategy) => (
                      <option key={strategy} value={strategy}>
                        {t(`game.bots.strategy.${strategy}`)}
                      </option>
                    ))}
                  </select>
                </label>

                <NumberField
                  label={t("game.bots.risk")}
                  value={bot.riskPct}
                  onChange={(v) => updateBot(bot.id, { riskPct: Math.max(0.1, Math.min(5, v)) })}
                />
                <NumberField
                  label={t("game.bots.stop")}
                  value={bot.stopPct}
                  onChange={(v) => updateBot(bot.id, { stopPct: Math.max(0.2, Math.min(20, v)) })}
                />
                <NumberField
                  label={t("game.bots.take")}
                  value={bot.takePct}
                  onChange={(v) => updateBot(bot.id, { takePct: Math.max(0.2, Math.min(40, v)) })}
                />

                <label className="flex items-center gap-1.5 text-xs text-muted cursor-pointer">
                  <input
                    type="checkbox"
                    checked={bot.enabled}
                    onChange={(e) => updateBot(bot.id, { enabled: e.target.checked })}
                    className="accent-accent"
                  />
                  {t("game.bots.enabled")}
                </label>

                <button
                  type="button"
                  onClick={() => removeBot(bot.id)}
                  className="ml-auto text-muted hover:text-loss"
                  title={t("game.bots.remove")}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <div className="text-[11px] text-faint">{t(`game.bots.strategyHint.${bot.strategy}`)}</div>
              {/* Статистика — то, ради чего вообще стоит смотреть на панель:
                  без неё «работает ли бот» приходится угадывать по балансу. */}
              <BotStats positions={positions} botId={bot.id} />
            </div>
          ))}

          {hasFreeSlot && (
            <div className="space-y-2 pt-1">
              <div className="text-[11px] uppercase tracking-wide text-muted">
                <HintLabel text={t("game.bots.licenseHint", { price: fmtUsd(BOT_LICENSE_PRICE) })}>
                  {t("game.bots.hire")}
                </HintLabel>
              </div>
              {!canAfford && <div className="text-[11px] text-loss">{t("game.bots.needCash", { price: fmtUsd(BOT_LICENSE_PRICE) })}</div>}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {BOT_PACKAGES.map((pkg) => (
                  <div key={pkg.id} className="rounded-lg border border-border p-3 space-y-1.5">
                    <div className="flex items-baseline justify-between">
                      <span className="text-sm font-medium">{t(`game.bots.package.${pkg.id}`)}</span>
                      <span className="text-xs tabular-nums text-muted">{fmtUsd(BOT_LICENSE_PRICE)}</span>
                    </div>
                    <div className="text-[11px] text-faint">{t(`game.bots.packageHint.${pkg.id}`)}</div>
                    <div className="text-[11px] text-muted tabular-nums">
                      {t("game.bots.risk")} {pkg.riskPct}% · {t("game.bots.stop")} {pkg.stopPct}% · {t("game.bots.take")} {pkg.takePct}%
                    </div>
                    <button
                      type="button"
                      disabled={!canAfford}
                      onClick={() => buyBotPackage(pkg.id, pickAssetFor ?? assets[0].id)}
                      className="w-full px-3 py-1.5 rounded-lg text-xs font-medium bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-40"
                    >
                      {t("game.bots.buy")}
                    </button>
                  </div>
                ))}
              </div>
              <label className="flex items-center gap-2 text-[11px] text-faint pt-1">
                {t("game.order.asset")}
                <select
                  value={pickAssetFor ?? assets[0]?.id}
                  onChange={(e) => setPickAssetFor(e.target.value)}
                  className="input-base px-2 py-1 text-xs"
                >
                  {assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>
                      {asset.symbol}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={!canAfford}
                onClick={() => addBot(pickAssetFor ?? assets[0].id)}
                className="px-3 py-2 rounded-lg text-sm font-medium text-muted hover:text-fg disabled:opacity-40"
              >
                {t("game.bots.addCustom")}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
