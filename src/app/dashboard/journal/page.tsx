"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check } from "lucide-react";
import type { StatsResponse, SerializedTrade } from "@/lib/types";
import { useI18n } from "@/lib/i18n/provider";
import { fmtUsd, fmtDate } from "@/lib/format";

function dayKey(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

const PAGE_SIZE = 10; // days per page

export default function JournalPage() {
  const { t } = useI18n();
  const [data, setData] = useState<StatsResponse | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const [statsRes, journalRes] = await Promise.all([
      fetch("/api/stats"),
      fetch("/api/journal"),
    ]);
    if (statsRes.ok) setData(await statsRes.json());
    if (journalRes.ok) setNotes((await journalRes.json()).notes ?? {});
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const byDay = useMemo(() => {
    const map = new Map<string, SerializedTrade[]>();
    for (const tr of data?.trades ?? []) {
      const k = dayKey(tr.exitTime);
      const arr = map.get(k);
      if (arr) arr.push(tr);
      else map.set(k, [tr]);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [data]);

  const totalPages = Math.max(1, Math.ceil(byDay.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pagedDays = byDay.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  async function saveNote(date: string, text: string) {
    setNotes((prev) => ({ ...prev, [date]: text }));
    await fetch("/api/journal", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, text }),
    }).catch(() => {});
  }

  return (
    <div className="px-6 py-5 max-w-4xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-semibold">{t("jr.title")}</h1>
        <p className="text-sm text-muted">{t("jr.subtitle")}</p>
      </div>

      {loading ? (
        <div className="text-sm text-faint">{t("common.loading")}</div>
      ) : byDay.length === 0 ? (
        <div className="card p-10 text-center text-muted">{t("jr.empty")}</div>
      ) : (
        <div className="space-y-4">
          {pagedDays.map(([date, dayTrades]) => {
            const pnl = dayTrades.reduce((s, x) => s + x.netPnl, 0);
            const wins = dayTrades.filter((x) => x.result === "win").length;
            const losses = dayTrades.filter((x) => x.result === "loss").length;
            return (
              <div key={date} className="card p-5">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                  <h3 className="font-medium">{fmtDate(date + "T00:00:00Z")}</h3>
                  <div className="flex items-center gap-3 text-xs text-faint">
                    <span>{dayTrades.length} {t("common.trades")}</span>
                    <span>{t("jr.dayResult", { w: wins, l: losses })}</span>
                    <span className={`text-sm font-semibold tabular-nums ${pnl >= 0 ? "text-profit" : "text-loss"}`}>
                      {fmtUsd(pnl, { sign: true })}
                    </span>
                  </div>
                </div>

                <div className="space-y-1 mb-3">
                  {dayTrades.map((tr) => (
                    <div key={tr.id} className="flex items-center justify-between border-b border-border/50 last:border-0 py-1.5 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{tr.symbol}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded ${tr.side === "long" ? "bg-profit/15 text-profit" : "bg-loss/15 text-loss"}`}>
                          {tr.side === "long" ? "Long" : "Short"}
                        </span>
                        {tr.mistake && (
                          <span className="text-xs px-1.5 py-0.5 rounded bg-warn/15 text-warn">{tr.mistake}</span>
                        )}
                      </div>
                      <span className={`tabular-nums font-medium ${tr.netPnl >= 0 ? "text-profit" : "text-loss"}`}>
                        {fmtUsd(tr.netPnl, { sign: true })}
                      </span>
                    </div>
                  ))}
                </div>

                <DayNote
                  initial={notes[date] ?? ""}
                  placeholder={t("jr.notePlaceholder")}
                  savedLabel={t("jr.noteSaved")}
                  onSave={(text) => saveNote(date, text)}
                />
              </div>
            );
          })}

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-1 text-sm">
              <span className="text-faint">
                {t("trades.page", { p: safePage + 1, total: totalPages })}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                  className="px-3 py-1.5 rounded-lg input-base disabled:opacity-40"
                >
                  {t("common.back")}
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={safePage >= totalPages - 1}
                  className="px-3 py-1.5 rounded-lg input-base disabled:opacity-40"
                >
                  {t("common.next")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DayNote({
  initial,
  placeholder,
  savedLabel,
  onSave,
}: {
  initial: string;
  placeholder: string;
  savedLabel: string;
  onSave: (text: string) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(false);
  useEffect(() => setDraft(initial), [initial]);

  function commit() {
    if (draft.trim() === initial.trim()) return;
    onSave(draft.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  return (
    <div className="relative">
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        placeholder={placeholder}
        rows={2}
        className="input-base w-full resize-y text-sm leading-relaxed"
      />
      {saved && (
        <span className="absolute right-2 top-2 inline-flex items-center gap-1 text-xs text-profit">
          <Check size={12} /> {savedLabel}
        </span>
      )}
    </div>
  );
}
