"use client";

import { useEffect, useState } from "react";
import { ArrowRight, ChevronUp, ChevronDown, History, Info } from "lucide-react";
import { fmtUsd, fmtDate, fmtTime } from "@/lib/format";
import { useI18n } from "@/lib/i18n/provider";
import { Select } from "@/components/Select";
import type { PeriodLimit } from "@/lib/risk";

// Журнал решений по риску: что было, что стало и почему.
//
// Зачем отдельной карточкой, а не строкой в настройках: комментарий — это
// текст в пару предложений, и ради него история живёт там, где его видно
// целиком. В самой форме остаётся только маркер несохранённого изменения.
//
// Вид строки (change / auto / initial) считает сервер — см.
// /api/risk/history. Здесь он только решает, что показывать.

type Entry = {
  id: string;
  accountId: string;
  accountLabel: string;
  effectiveFrom: string;
  amount: number | null;
  riskPerTrade: PeriodLimit | null;
  prevAmount: number | null;
  prevRiskPerTrade: PeriodLimit | null;
  comment: string | null;
  kind: "initial" | "setup" | "change" | "auto";
};

function fmtLimit(l: PeriodLimit | null): string {
  if (!l || !l.on || l.value <= 0) return "—";
  return l.unit === "pct" ? `${l.value} %` : fmtUsd(l.value);
}

export default function RiskHistory({ reloadKey = 0 }: { reloadKey?: number }) {
  const { t } = useI18n();
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [account, setAccount] = useState("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/risk/history");
      if (!res.ok || cancelled) return;
      const { entries } = (await res.json()) as { entries: Entry[] };
      if (!cancelled) setEntries(entries);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  if (entries == null) return null;

  // Счета для фильтра — только те, по которым история вообще есть.
  const accounts = Array.from(
    new Map(entries.map((e) => [e.accountId, e.accountLabel])).entries(),
  );
  const rows = account === "all" ? entries : entries.filter((e) => e.accountId === account);

  return (
    <div className="space-y-3 pt-2">
      <div className="flex items-center gap-3">
        <History size={17} className="text-accent shrink-0" />
        <h3 className="text-base font-semibold flex-1">{t("risk.history.title")}</h3>
        {accounts.length > 1 && (
          <Select
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            className="input-base text-sm py-1 cursor-pointer"
            aria-label={t("risk.history.account")}
          >
            <option value="all">{t("risk.history.allAccounts")}</option>
            {accounts.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </Select>
        )}
      </div>

      {rows.length === 0 ? (
        <div className="card p-4 text-sm text-muted">{t("risk.history.empty")}</div>
      ) : (
        <div className="card divide-y divide-border">
          {rows.map((e) => (
            <HistoryRow key={e.id} entry={e} showAccount={account === "all"} />
          ))}
        </div>
      )}

      <p className="text-xs text-faint flex items-start gap-1.5">
        <Info size={13} className="shrink-0 mt-0.5" />
        {t("risk.history.footer")}
      </p>
    </div>
  );
}

function HistoryRow({ entry, showAccount }: { entry: Entry; showAccount: boolean }) {
  const { t } = useI18n();

  // Начальное значение: решения за ним нет, показываем одной строкой.
  if (entry.kind === "initial") {
    return (
      <div className="flex items-center gap-3 px-4 py-3 flex-wrap">
        <span className="text-xs text-faint tabular-nums w-24 shrink-0">—</span>
        <span className="text-sm text-muted tabular-nums">{fmtLimit(entry.riskPerTrade)}</span>
        <span className="text-sm text-faint">{t("risk.history.initial")}</span>
        {showAccount && <span className="text-xs text-faint ml-auto">{entry.accountLabel}</span>}
      </div>
    );
  }

  // Риск завели впервые — комментарий не требовался, и подписывать строку
  // «без комментария» было бы неправдой о причине его отсутствия.
  if (entry.kind === "setup") {
    return (
      <div className="flex items-center gap-3 px-4 py-3 flex-wrap">
        <span className="text-xs text-faint tabular-nums w-24 shrink-0">
          {fmtDate(entry.effectiveFrom)}
        </span>
        <span className="text-sm font-medium tabular-nums">{fmtLimit(entry.riskPerTrade)}</span>
        <span className="text-sm text-faint">{t("risk.history.setup")}</span>
        {entry.amount != null && (
          <span className="text-xs text-faint tabular-nums">1R: {fmtUsd(entry.amount)}</span>
        )}
        {showAccount && <span className="text-xs text-faint ml-auto">{entry.accountLabel}</span>}
      </div>
    );
  }

  // 1R переехал сам вслед за капиталом — приглушаем: объяснять нечего.
  if (entry.kind === "auto") {
    return (
      <div className="flex items-center gap-3 px-4 py-3 flex-wrap opacity-70">
        <span className="text-xs text-faint tabular-nums w-24 shrink-0">
          {fmtDate(entry.effectiveFrom)}
        </span>
        <span className="text-sm text-muted tabular-nums">{fmtLimit(entry.riskPerTrade)}</span>
        <span className="text-xs text-faint tabular-nums">
          1R: {entry.prevAmount != null ? fmtUsd(entry.prevAmount) : "—"} →{" "}
          {entry.amount != null ? fmtUsd(entry.amount) : "—"}
        </span>
        <span className="text-[11px] text-faint border border-border rounded-full px-2 py-0.5">
          {t("risk.history.auto")}
        </span>
        {showAccount && <span className="text-xs text-faint ml-auto">{entry.accountLabel}</span>}
      </div>
    );
  }

  // Решение человека. Рост риска красим предупреждающим, снижение — зелёным:
  // это не «хорошо/плохо», а направление, и его видно до чтения цифр.
  const up =
    entry.amount != null && entry.prevAmount != null
      ? entry.amount > entry.prevAmount
      : null;

  return (
    <div className="flex gap-4 px-4 py-4">
      <div className="w-24 shrink-0">
        <div className="text-xs tabular-nums">{fmtDate(entry.effectiveFrom)}</div>
        <div className="text-[11px] text-faint tabular-nums">
          {fmtTime(entry.effectiveFrom)}
        </div>
      </div>
      <div className={`w-0.5 shrink-0 rounded-full ${up === false ? "bg-profit" : "bg-warn"}`} />
      <div className="flex-1 space-y-2 min-w-0">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="text-sm text-muted tabular-nums">{fmtLimit(entry.prevRiskPerTrade)}</span>
          <ArrowRight size={14} className="text-faint" />
          <span
            className={`text-sm font-semibold tabular-nums ${up === false ? "text-profit" : "text-warn"}`}
          >
            {fmtLimit(entry.riskPerTrade)}
          </span>
          {up != null && (
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                up ? "bg-warn/10 text-warn" : "bg-profit/10 text-profit"
              }`}
            >
              {up ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              {t(up ? "risk.history.up" : "risk.history.down")}
            </span>
          )}
          {entry.prevAmount != null && entry.amount != null && (
            <span className="text-xs text-faint tabular-nums">
              1R: {fmtUsd(entry.prevAmount)} → {fmtUsd(entry.amount)}
            </span>
          )}
        </div>
        {entry.comment ? (
          <p className="text-sm leading-relaxed bg-surface-2 rounded-lg px-3 py-2 break-words">
            {entry.comment}
          </p>
        ) : (
          // Строки, записанные до того, как комментарий стал обязательным.
          <p className="text-xs text-faint italic">{t("risk.history.noComment")}</p>
        )}
        {showAccount && <div className="text-[11px] text-faint">{entry.accountLabel}</div>}
      </div>
    </div>
  );
}
