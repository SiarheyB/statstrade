"use client";

// «Пока тебя не было» — первое, что видит вернувшийся игрок.
//
// Это не украшение: именно ради такого отчёта возвращаются в браузерные
// экономические игры. Он же честно показывает цену удержания позиции через
// ночь — если стоп сработал без тебя, ты узнаешь об этом здесь, а не по
// изменившемуся балансу.
import { useI18n } from "@/lib/i18n/provider";
import { fmtUsd } from "@/lib/format";
import { useGameStore } from "@/store/gameStore";
import { getContract } from "@/engine/player/contracts";

export default function OfflineReportModal() {
  const { t } = useI18n();
  const report = useGameStore((s) => s.offlineReport);
  const dismiss = useGameStore((s) => s.dismissOfflineReport);
  if (!report) return null;

  const equityDelta = report.equityAfter - report.equityBefore;
  const equityPct = report.equityBefore > 0 ? (equityDelta / report.equityBefore) * 100 : 0;
  const contract = report.contractFinished ? getContract(report.contractFinished) : null;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4">
      <div className="card p-6 w-full max-w-md space-y-4">
        <div>
          <div className="text-lg font-semibold">{t("game.offline.title")}</div>
          <div className="text-xs text-faint">{t("game.offline.subtitle", { days: report.gameDays })}</div>
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-muted">{t("game.stat.equity")}</span>
            <span className={`tabular-nums font-medium ${equityDelta >= 0 ? "text-profit" : "text-loss"}`}>
              {equityDelta >= 0 ? "+" : ""}
              {fmtUsd(equityDelta)} ({equityDelta >= 0 ? "+" : ""}
              {equityPct.toFixed(2)}%)
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted">{t("game.offline.balance")}</span>
            <span className={`tabular-nums ${report.balanceChange >= 0 ? "text-profit" : "text-loss"}`}>
              {report.balanceChange >= 0 ? "+" : ""}
              {fmtUsd(report.balanceChange)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted">{t("game.offline.trades")}</span>
            <span className="tabular-nums">{report.tradesClosed}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-muted">{t("game.offline.news")}</span>
            <span className="tabular-nums">{report.newsCount}</span>
          </div>
          {contract && (
            <div className="rounded-lg bg-surface-2 p-2 text-xs">
              {t("game.offline.contractFinished", { name: t(`game.contract.${contract.id}.name`) })}
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={dismiss}
          className="w-full px-4 py-2 rounded-lg text-sm font-medium bg-accent text-white"
        >
          {t("game.offline.continue")}
        </button>
      </div>
    </div>
  );
}
