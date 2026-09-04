"use client";

// Алго-боты: настройка стратегий, которые торгуют сами. Слоты открываются
// перками ветки «Автоматика» — до первого перка панель объясняет, что нужно
// сделать, а не просто пустует.
import { Bot, Trash2 } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { useGameStore } from "@/store/gameStore";
import { botSlots, type AlgoBot, type BotStrategy } from "@/engine/player/algoBots";
import type { Asset, PerkState } from "@/engine/entities/types";

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
  const updateBot = useGameStore((s) => s.updateBot);
  const removeBot = useGameStore((s) => s.removeBot);

  const slots = botSlots(perks.unlocked);

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
            </div>
          ))}

          {bots.length < slots && assets.length > 0 && (
            <button
              type="button"
              onClick={() => addBot(assets[0].id)}
              className="px-3 py-2 rounded-lg text-sm font-medium bg-accent/15 text-accent hover:bg-accent/25"
            >
              {t("game.bots.add")}
            </button>
          )}
        </>
      )}
    </div>
  );
}
