"use client";

// Контракты (испытания) — главный ответ на вопрос «а что мне тут делать».
//
// Показываем ОДНУ активную цель крупно и одну следующую ступень: список из
// десяти задач размывает фокус, а испытание должно быть ровно одно — как в
// prop-firm челленджах, с которых списан формат.
//
// Срок указан в днях и это РЕАЛЬНЫЕ дни: игровое время идёт вровень с
// реальным, поэтому трёхдневное испытание — это три дня жизни, а не
// «три дня на дейтрейдинге, минута на инвестициях», как было при ускорении.
import { useI18n } from "@/lib/i18n/provider";
import { fmtUsd } from "@/lib/format";
import { availableContracts, contractProgress, getContract } from "@/engine/player/contracts";
import { useGameStore } from "@/store/gameStore";
import type { ContractState } from "@/engine/entities/types";

function Bar({ value, limit, tone }: { value: number; limit: number; tone: "good" | "bad" }) {
  const pct = Math.max(0, Math.min(100, (value / (limit || 1)) * 100));
  return (
    <div className="mt-1.5 h-2 w-full rounded-full bg-surface-2 overflow-hidden">
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${tone === "good" ? "bg-profit" : "bg-loss"}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function ContractsPanel({
  contracts,
  equity,
  balance,
  currentDay,
}: {
  contracts: ContractState;
  equity: number;
  balance: number;
  currentDay: number;
}) {
  const { t } = useI18n();
  const start = useGameStore((s) => s.startContract);
  const abandon = useGameStore((s) => s.abandonContract);

  const active = contracts.active;
  const progress = active ? contractProgress(active, equity, currentDay) : null;
  const next = availableContracts(contracts)[0];

  return (
    <div className="space-y-4">
      {progress ? (
        <div className="card p-4 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.12em] text-accent">{t("game.contract.active")}</div>
              <div className="text-lg font-semibold">{t(`game.contract.${progress.contract.id}.name`)}</div>
              <div className="text-xs text-faint">{t(`game.contract.${progress.contract.id}.desc`)}</div>
            </div>
            <button
              type="button"
              onClick={abandon}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted hover:text-loss transition"
            >
              {t("game.contract.abandon")}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-muted">{t("game.contract.target")}</span>
                <span className="tabular-nums">
                  {progress.profitPct >= 0 ? "+" : ""}
                  {progress.profitPct.toFixed(2)}% / +{progress.contract.targetPct}%
                </span>
              </div>
              <Bar value={Math.max(0, progress.profitPct)} limit={progress.contract.targetPct} tone="good" />
            </div>
            <div>
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-muted">{t("game.contract.drawdown")}</span>
                <span className="tabular-nums">
                  −{progress.drawdownPct.toFixed(2)}% / −{progress.contract.maxDrawdownPct}%
                </span>
              </div>
              {/* Просадка — единственная полоса, которую игрок хочет видеть
                  пустой. Заполнилась до конца — испытание провалено. */}
              <Bar value={progress.drawdownPct} limit={progress.contract.maxDrawdownPct} tone="bad" />
            </div>
            <div>
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-muted">{t("game.contract.daysLeft")}</span>
                <span className="tabular-nums">
                  {progress.daysLeft} / {progress.contract.durationDays}
                </span>
              </div>
              <Bar
                value={progress.contract.durationDays - progress.daysLeft}
                limit={progress.contract.durationDays}
                tone="good"
              />
            </div>
          </div>

          <div className="text-xs text-faint">
            {t("game.contract.rewardLine", {
              cash: fmtUsd(progress.contract.reward.cash),
              prestige: progress.contract.reward.prestige,
              points: progress.contract.reward.skillPoints,
            })}
          </div>
        </div>
      ) : next ? (
        <div className="card p-4 space-y-3">
          <div>
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted">{t("game.contract.next")}</div>
            <div className="text-lg font-semibold">{t(`game.contract.${next.id}.name`)}</div>
            <div className="text-xs text-faint">{t(`game.contract.${next.id}.desc`)}</div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div>
              <div className="text-[11px] text-muted">{t("game.contract.target")}</div>
              <div className="tabular-nums text-profit">+{next.targetPct}%</div>
            </div>
            <div>
              <div className="text-[11px] text-muted">{t("game.contract.maxDrawdown")}</div>
              <div className="tabular-nums text-loss">−{next.maxDrawdownPct}%</div>
            </div>
            <div>
              <div className="text-[11px] text-muted">{t("game.contract.duration")}</div>
              <div className="tabular-nums">{next.durationDays}</div>
            </div>
            <div>
              <div className="text-[11px] text-muted">{t("game.contract.fee")}</div>
              <div className="tabular-nums">{next.entryFee === 0 ? t("game.shop.free") : fmtUsd(next.entryFee)}</div>
            </div>
          </div>

          <div className="text-xs text-faint">
            {t("game.contract.rewardLine", {
              cash: fmtUsd(next.reward.cash),
              prestige: next.reward.prestige,
              points: next.reward.skillPoints,
            })}
            {next.reward.unlockMarkets.length > 0 && (
              <>
                {" · "}
                {t("game.contract.unlocks", {
                  markets: next.reward.unlockMarkets.map((m) => t(`game.assetClass.${m}`)).join(", "),
                })}
              </>
            )}
          </div>

          <button
            type="button"
            disabled={next.entryFee > balance}
            onClick={() => start(next.id)}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {next.entryFee > balance ? t("game.contract.needMoney") : t("game.contract.start")}
          </button>
        </div>
      ) : (
        <div className="card p-4 text-sm text-faint">{t("game.contract.allDone")}</div>
      )}

      {contracts.history.length > 0 && (
        <div className="card p-4">
          <div className="text-sm font-medium mb-2">{t("game.contract.history")}</div>
          <div className="space-y-1.5">
            {contracts.history.slice(0, 8).map((record, i) => {
              const contract = getContract(record.contractId);
              const passed = record.outcome === "passed";
              return (
                <div key={`${record.contractId}-${record.finishedDay}-${i}`} className="flex items-center gap-2 text-xs">
                  <span className={`px-1.5 py-0.5 rounded ${passed ? "bg-profit/15 text-profit" : "bg-loss/15 text-loss"}`}>
                    {t(`game.contract.outcome.${record.outcome}`)}
                  </span>
                  <span className="flex-1 truncate">
                    {contract ? t(`game.contract.${contract.id}.name`) : record.contractId}
                  </span>
                  <span className="text-faint tabular-nums">{t("game.contract.onDay", { day: record.finishedDay + 1 })}</span>
                  <span className={`tabular-nums w-16 text-right ${record.resultPct >= 0 ? "text-profit" : "text-loss"}`}>
                    {record.resultPct >= 0 ? "+" : ""}
                    {record.resultPct.toFixed(1)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
