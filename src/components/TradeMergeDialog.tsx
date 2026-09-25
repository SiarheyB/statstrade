"use client";

// Подтверждение объединения сетки в одну сделку: показывает, что получится,
// ДО того как что-то изменится, и предупреждает о разбросе стопов.
//
// Разброс не блокирует объединение — он влияет только на точность R (деньги
// берутся суммой от брокера и от усреднения не страдают). Поэтому текст
// говорит именно про R, а не абстрактное «данные различаются»: человек должен
// понимать, какая цифра поплывёт, и получить совет на будущее.

import { X, AlertTriangle, Check } from "lucide-react";
import type { SerializedTrade } from "@/lib/types";
import { aggregateGroup, spreadLevel, type GroupMember } from "@/lib/trades/grouping";
import { fmtPrice, fmtUsd, fmtNumSmart, fmtSymbol } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";

function toMember(tr: SerializedTrade): GroupMember {
  return {
    id: tr.id,
    side: tr.side,
    lots: tr.lots ?? 0,
    qty: tr.qty,
    entryTime: new Date(tr.entryTime),
    exitTime: new Date(tr.exitTime),
    entryPrice: tr.entryPrice,
    exitPrice: tr.exitPrice,
    stopLoss: tr.stopLoss,
    takeProfit: null,
    commission: tr.commission ?? tr.fees,
    swap: tr.swap ?? 0,
    grossProfit: tr.grossPnl,
    netPnl: tr.netPnl,
  };
}

export default function TradeMergeDialog({
  trades,
  busy,
  onConfirm,
  onCancel,
}: {
  trades: SerializedTrade[];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  if (trades.length < 2) return null;

  const agg = aggregateGroup(trades.map(toMember));
  const level = spreadLevel(agg.stopSpread);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
    >
      {/* bg-surface, не bg-surface-1: такого токена в globals.css нет, и панель
          осталась бы прозрачной поверх таблицы (см. CLAUDE.md). */}
      <div
        className="w-full max-w-lg rounded-xl border border-border bg-surface shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium">{t("trades.group.title")}</h2>
          <button onClick={onCancel} className="text-faint hover:text-fg" aria-label={t("trades.group.cancel")}>
            <X size={16} />
          </button>
        </div>

        <div className="px-4 py-3 space-y-3">
          <div className="text-xs text-faint">
            {fmtSymbol(trades[0].symbol)} · {t("trades.group.members", { n: agg.memberCount })}
          </div>

          <div className="rounded-lg border border-border bg-surface-2/40 p-3">
            <div className="mb-2 text-xs text-faint">{t("trades.group.preview")}</div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <Row label={t("trades.group.avgEntry")} value={fmtPrice(agg.entryPrice)} />
              <Row label={t("trades.group.avgExit")} value={fmtPrice(agg.exitPrice)} />
              <Row
                label={t("trades.group.avgStop")}
                value={agg.stopLoss != null ? fmtPrice(agg.stopLoss) : "—"}
              />
              <Row label={t("trades.col.qty")} value={fmtNumSmart(agg.lots, 2)} />
              <Row
                label={t("trades.col.netPnl")}
                value={fmtUsd(agg.netPnl, { sign: true })}
                tone={agg.netPnl >= 0 ? "profit" : "loss"}
              />
              <Row label={t("trades.col.fees")} value={fmtUsd(agg.commission)} />
            </dl>
          </div>

          {level === "exact" && agg.stopLoss != null && (
            <p className="flex items-start gap-2 text-xs text-profit">
              <Check size={14} className="mt-0.5 shrink-0" />
              {t("trades.group.stopsMatch")}
            </p>
          )}
          {level === "minor" && (
            <p className="text-xs text-faint">
              {t("trades.group.stopsRange", {
                min: fmtPrice(agg.stopMin ?? 0),
                max: fmtPrice(agg.stopMax ?? 0),
              })}
            </p>
          )}
          {level === "warn" && (
            <div className="rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs text-warn">
              <p className="flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  {t("trades.group.stopsWarn", {
                    pct: `${Math.round((agg.stopSpread ?? 0) * 100)}%`,
                    min: fmtPrice(agg.stopMin ?? 0),
                    max: fmtPrice(agg.stopMax ?? 0),
                    avg: fmtPrice(agg.stopLoss ?? 0),
                  })}
                </span>
              </p>
              <p className="mt-2 pl-6 text-muted">{t("trades.group.stopsAdvice")}</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:text-fg"
          >
            {t("trades.group.cancel")}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {t("trades.group.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "profit" | "loss";
}) {
  return (
    <>
      <dt className="text-faint">{label}</dt>
      <dd
        className={`text-right tabular-nums ${
          tone === "profit" ? "text-profit" : tone === "loss" ? "text-loss" : ""
        }`}
      >
        {value}
      </dd>
    </>
  );
}
