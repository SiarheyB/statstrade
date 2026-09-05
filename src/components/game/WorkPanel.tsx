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
import { advanceAvailable, getJob, hireError, JOBS, type Job } from "@/engine/player/jobs";
import { FUND_LICENSE_ITEM_ID } from "@/engine/economy/shop";
import type { JobState } from "@/engine/entities/types";
import { useGameStore } from "@/store/gameStore";
import Hint, { HintLabel } from "./Hint";

// Карточка занятой ставки. Одна и та же для основной работы и подработки:
// отличаются они только подписью и тем, какую ставку освобождает увольнение.
function HeldJob({ state, job, kind }: { state: JobState; job: Job; kind: "main" | "side" }) {
  const { t } = useI18n();
  const quitJob = useGameStore((s) => s.quitJob);
  const takeAdvance = useGameStore((s) => s.takeAdvance);
  const available = advanceAvailable(state, job);

  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-surface-2 p-3 space-y-1.5 text-sm">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-medium">{t(`game.job.${job.id}.name`)}</span>
          <span className="text-[11px] uppercase tracking-[0.12em] text-accent">
            {t(kind === "side" ? "game.work.sideJob" : "game.work.mainJob")}
          </span>
        </div>
        <div className="text-xs text-faint">{t(`game.job.${job.id}.desc`)}</div>
        <div className="flex flex-wrap gap-4 pt-1 text-xs">
          <span>
            <span className="text-muted">{t("game.work.salary")}: </span>
            <span className="tabular-nums text-profit">{fmtUsd(job.dailySalary)}</span>
          </span>
          <span>
            <span className="text-muted">{t("game.work.earned")}: </span>
            <span className="tabular-nums">{fmtUsd(state.earned)}</span>
          </span>
          {state.advanceDebt > 0 && (
            <span>
              <span className="text-muted">{t("game.work.advanceDebt")}: </span>
              <span className="tabular-nums text-loss">{fmtUsd(state.advanceDebt)}</span>
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={available <= 0}
          onClick={() => takeAdvance(available, kind)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-40"
        >
          <HandCoins size={14} />
          {t("game.work.takeAdvance", { amount: fmtUsd(available) })}
        </button>
        <button
          type="button"
          onClick={() => quitJob(kind)}
          className="px-3 py-1.5 rounded-lg text-sm text-muted hover:text-loss transition"
        >
          {t("game.work.quit")}
        </button>
      </div>
    </div>
  );
}

export default function WorkPanel() {
  const { t } = useI18n();
  const game = useGameStore((s) => s.game);
  const takeJob = useGameStore((s) => s.takeJob);
  const moveToBroker = useGameStore((s) => s.moveToBroker);
  const moveToWallet = useGameStore((s) => s.moveToWallet);
  const declareBankruptcy = useGameStore((s) => s.declareBankruptcy);

  const [amount, setAmount] = useState("");
  const [confirming, setConfirming] = useState(false);

  const jobState = game.career.job;
  const job = jobState ? getJob(jobState.jobId) : undefined;
  const sideState = game.career.sideJob ?? null;
  const sideJob = sideState ? getJob(sideState.jobId) : undefined;
  const ownsFund = game.lifestyle.ownedItemIds.includes(FUND_LICENSE_ITEM_ID);
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

        {/* Занятые ставки — сверху, вакансии — под ними: сначала «где я
            работаю», потом «куда ещё можно». */}
        {jobState && job && <HeldJob state={jobState} job={job} kind="main" />}
        {sideState && sideJob && <HeldJob state={sideState} job={sideJob} kind="side" />}
        {(jobState || sideState) && <p className="text-[11px] text-faint max-w-prose">{t("game.work.advanceHint")}</p>}

        <div className="space-y-2">
          {/* Правила совмещения объясняем прямо здесь, а не только
              заблокированной кнопкой: человек должен понимать, почему
              вакансия недоступна, ДО того как ткнёт в неё. */}
          <p className="text-xs text-faint max-w-prose">
            {t(ownsFund ? "game.work.fundOwnerHint" : "game.work.pickHint")}
          </p>
          {JOBS.map((item) => {
            const held = item.id === jobState?.jobId || item.id === sideState?.jobId;
            if (held) return null;
            const error = hireError(item, game.career, ownsFund, stats);
            return (
              <div key={item.id} className="flex flex-wrap items-center gap-2 border-t border-border pt-2 text-sm">
                <span className={`font-medium ${error ? "text-faint" : ""}`}>{t(`game.job.${item.id}.name`)}</span>
                {item.side && (
                  <span className="text-[10px] uppercase tracking-[0.12em] text-accent">{t("game.work.sideJob")}</span>
                )}
                <span className="text-xs text-faint flex-1 min-w-[160px]">{t(`game.job.${item.id}.desc`)}</span>
                <span className="tabular-nums text-profit">{fmtUsd(item.dailySalary)}</span>
                <Hint text={error ? t(`game.work.hire.${error}`) : t("game.work.takeHint")} side="top" align="end">
                  <button
                    type="button"
                    disabled={error !== null}
                    onClick={() => takeJob(item.id)}
                    className="px-3 py-1 rounded-lg text-xs font-medium bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-30"
                  >
                    {t("game.work.take")}
                  </button>
                </Hint>
              </div>
            );
          })}
        </div>
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
