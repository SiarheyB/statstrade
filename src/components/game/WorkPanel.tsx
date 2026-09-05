"use client";

// Работа, кошелёк и банкротство.
//
// Кнопки «начать заново» в игре нет намеренно. Обнуление стирает не только
// деньги, но и цену ошибки: если из любой ямы можно выйти нажатием кнопки,
// падать не страшно, и весь риск-менеджмент превращается в формальность.
//
// Выход из ямы один и он рабочий: объявить себя банкротом, устроиться на
// работу, накопить или взять аванс — и решить, сколько из заработанного
// поставить на кон. Деньги, добытые неделей работы, ставят осторожнее, чем
// выданные кнопкой.
import { useState } from "react";
import { Briefcase, HandCoins, Wallet } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { fmtUsd } from "@/lib/format";
import { advanceAvailable, getJob, jobAvailable, JOBS } from "@/engine/player/jobs";
import { useGameStore } from "@/store/gameStore";
import { HintLabel } from "./Hint";

export default function WorkPanel() {
  const { t } = useI18n();
  const game = useGameStore((s) => s.game);
  const takeJob = useGameStore((s) => s.takeJob);
  const quitJob = useGameStore((s) => s.quitJob);
  const takeAdvance = useGameStore((s) => s.takeAdvance);
  const moveToBroker = useGameStore((s) => s.moveToBroker);
  const moveToWallet = useGameStore((s) => s.moveToWallet);
  const declareBankruptcy = useGameStore((s) => s.declareBankruptcy);

  const [amount, setAmount] = useState("");
  const [confirming, setConfirming] = useState(false);

  const jobState = game.career.job;
  const job = jobState ? getJob(jobState.jobId) : undefined;
  const levels = Object.values(game.account.skills).map((skill) => skill.level);
  const stats = {
    prestige: game.account.reputation,
    level: levels.length > 0 ? Math.max(...levels) : 0,
    contractsPassed: game.contracts.completedIds.length,
  };
  const sum = Number(amount) || 0;

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="inline-flex items-center gap-2 text-sm font-medium">
              <Wallet size={15} className="text-accent" />
              <HintLabel text={t("game.tip.wallet")}>{t("game.work.wallet")}</HintLabel>
            </div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{fmtUsd(game.wallet)}</div>
          </div>
          <div className="text-right">
            <div className="text-[11px] uppercase tracking-[0.12em] text-muted">{t("game.stat.balance")}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{fmtUsd(game.account.balance)}</div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={t("game.work.amount")}
            className="input-base w-32 px-2 py-1.5 text-sm tabular-nums"
          />
          <button
            type="button"
            disabled={!(sum > 0) || sum > game.wallet}
            onClick={() => {
              moveToBroker(sum);
              setAmount("");
            }}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-accent text-white disabled:opacity-40"
          >
            {t("game.work.toBroker")}
          </button>
          <button
            type="button"
            disabled={!(sum > 0) || sum > game.account.balance}
            onClick={() => {
              moveToWallet(sum);
              setAmount("");
            }}
            className="input-base px-3 py-1.5 text-sm hover:border-border-strong disabled:opacity-40"
          >
            {t("game.work.toWallet")}
          </button>
        </div>
        <p className="text-[11px] text-faint max-w-prose">{t("game.work.walletHint")}</p>
      </div>

      <div className="card p-4 space-y-3">
        <div className="inline-flex items-center gap-2 text-sm font-medium">
          <Briefcase size={15} className="text-accent" />
          {t("game.work.title")}
        </div>

        {jobState && job ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-surface-2 p-3 space-y-1.5 text-sm">
              <div className="font-medium">{t(`game.job.${job.id}.name`)}</div>
              <div className="text-xs text-faint">{t(`game.job.${job.id}.desc`)}</div>
              <div className="flex flex-wrap gap-4 pt-1 text-xs">
                <span>
                  <span className="text-muted">{t("game.work.salary")}: </span>
                  <span className="tabular-nums text-profit">{fmtUsd(job.dailySalary)}</span>
                </span>
                <span>
                  <span className="text-muted">{t("game.work.earned")}: </span>
                  <span className="tabular-nums">{fmtUsd(jobState.earned)}</span>
                </span>
                {jobState.advanceDebt > 0 && (
                  <span>
                    <span className="text-muted">{t("game.work.advanceDebt")}: </span>
                    <span className="tabular-nums text-loss">{fmtUsd(jobState.advanceDebt)}</span>
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={advanceAvailable(jobState, job) <= 0}
                onClick={() => takeAdvance(advanceAvailable(jobState, job))}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-40"
              >
                <HandCoins size={14} />
                {t("game.work.takeAdvance", { amount: fmtUsd(advanceAvailable(jobState, job)) })}
              </button>
              <button
                type="button"
                onClick={quitJob}
                className="px-3 py-1.5 rounded-lg text-sm text-muted hover:text-loss transition"
              >
                {t("game.work.quit")}
              </button>
            </div>
            <p className="text-[11px] text-faint max-w-prose">{t("game.work.advanceHint")}</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-faint max-w-prose">{t("game.work.pickHint")}</p>
            {JOBS.map((item) => {
              const available = jobAvailable(item, stats);
              return (
                <div key={item.id} className="flex flex-wrap items-center gap-2 border-t border-border pt-2 text-sm">
                  <span className={`font-medium ${available ? "" : "text-faint"}`}>{t(`game.job.${item.id}.name`)}</span>
                  <span className="text-xs text-faint flex-1 min-w-[160px]">{t(`game.job.${item.id}.desc`)}</span>
                  <span className="tabular-nums text-profit">{fmtUsd(item.dailySalary)}</span>
                  <button
                    type="button"
                    disabled={!available}
                    onClick={() => takeJob(item.id)}
                    className="px-3 py-1 rounded-lg text-xs font-medium bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-30"
                    title={available ? undefined : t("game.work.locked")}
                  >
                    {t("game.work.take")}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium">{t("game.work.bankruptcy")}</div>
            <div className="text-xs text-faint max-w-xl">{t("game.work.bankruptcyHint")}</div>
            {game.career.bankruptcies > 0 && (
              <div className="mt-1 text-[11px] text-faint">
                {t("game.work.bankruptcyCount", { count: game.career.bankruptcies })}
              </div>
            )}
          </div>
          {confirming ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-loss">{t("game.work.bankruptcyConfirm")}</span>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  declareBankruptcy();
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
              className="px-3 py-2 rounded-lg text-sm text-muted hover:text-loss transition"
            >
              {t("game.work.declare")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
