"use client";

// Дневник трейдера — раздел 9 спеки (<Journal>): список закрытых сделок с
// rMultiple, тегами и заметкой. Записи создаёт движок автоматически при
// закрытии позиции (gameLoop.applyPositionClose) — здесь только просмотр и
// необязательное тегирование (раздел 9 говорит про "обязательную форму" в
// потоке онбординга конкретно; здесь — открытый список, тегировать можно в
// любой момент, а не только сразу после закрытия).
//
// Сверху — базовые метрики портфеля (<PortfolioDashboard>, раздел 9):
// winrate, средний R, макс. просадка, упрощённый Sharpe.
import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { fmtUsd, fmtPct } from "@/lib/format";
import { calculatePortfolioMetrics } from "@/engine/player/portfolioMetrics";
import { useGameStore } from "@/store/gameStore";
import type { Asset, JournalEntry, Position } from "@/engine/entities/types";

function symbolFor(assets: Asset[], positions: Position[], positionId: string): string {
  const position = positions.find((p) => p.id === positionId);
  if (!position) return "—";
  return assets.find((a) => a.id === position.assetId)?.symbol ?? position.assetId;
}

export default function Journal({
  journal,
  positions,
  assets,
  startingBalance,
}: {
  journal: JournalEntry[];
  positions: Position[];
  assets: Asset[];
  startingBalance: number;
}) {
  const { t } = useI18n();
  const updateJournalEntry = useGameStore((s) => s.updateJournalEntry);

  const metrics = useMemo(() => calculatePortfolioMetrics(journal, startingBalance), [journal, startingBalance]);
  const sorted = useMemo(() => [...journal].sort((a, b) => b.timestampClosed - a.timestampClosed), [journal]);

  return (
    <div className="card p-4 space-y-4">
      <div>
        <div className="text-[11px] uppercase tracking-wide text-faint mb-2">{t("game.journal.metricsTitle")}</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Metric label={t("game.journal.winRate")} value={metrics.winRate != null ? fmtPct(metrics.winRate * 100, 0) : "—"} />
          <Metric label={t("game.journal.avgR")} value={metrics.avgRMultiple != null ? `${metrics.avgRMultiple.toFixed(2)}R` : "—"} />
          <Metric
            label={t("game.journal.maxDrawdown")}
            value={metrics.maxDrawdownPct != null ? `${metrics.maxDrawdownPct.toFixed(1)}%` : "—"}
            tone={metrics.maxDrawdownPct != null && metrics.maxDrawdownPct > 0 ? "loss" : undefined}
          />
          <Metric label={t("game.journal.sharpe")} value={metrics.simplifiedSharpe != null ? metrics.simplifiedSharpe.toFixed(2) : "—"} />
        </div>
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-wide text-faint mb-2">{t("game.journal.title")}</div>
        {sorted.length === 0 ? (
          <div className="text-sm text-faint py-4 text-center">{t("game.journal.empty")}</div>
        ) : (
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {sorted.map((entry) => (
              <JournalRow
                key={entry.id}
                entry={entry}
                symbol={symbolFor(assets, positions, entry.positionId)}
                onSave={(patch) => updateJournalEntry(entry.id, patch)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "profit" | "loss" }) {
  return (
    <div>
      <div className="text-[10px] text-faint">{label}</div>
      <div className={`text-sm font-medium tabular-nums ${tone === "profit" ? "text-profit" : tone === "loss" ? "text-loss" : "text-fg"}`}>
        {value}
      </div>
    </div>
  );
}

function JournalRow({
  entry,
  symbol,
  onSave,
}: {
  entry: JournalEntry;
  symbol: string;
  onSave: (patch: { tags?: string[]; note?: string }) => void;
}) {
  const { t, locale } = useI18n();
  const [tagsDraft, setTagsDraft] = useState(entry.tags.join(", "));
  const [noteDraft, setNoteDraft] = useState(entry.note ?? "");

  function commitTags() {
    const tags = tagsDraft
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    onSave({ tags });
  }

  return (
    <div className="rounded-lg border border-border p-2.5 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{symbol}</span>
        <span className="text-[11px] text-faint">{new Date(entry.timestampClosed).toLocaleString(locale)}</span>
      </div>
      <div className="flex items-center gap-3 mt-1 text-xs">
        <span className={`tabular-nums font-medium ${entry.pnl >= 0 ? "text-profit" : "text-loss"}`}>{fmtUsd(entry.pnl, { sign: true })}</span>
        <span className="text-faint tabular-nums">{entry.rMultiple.toFixed(2)}R</span>
      </div>
      <input
        type="text"
        value={tagsDraft}
        placeholder={t("game.journal.tagsPlaceholder")}
        onChange={(e) => setTagsDraft(e.target.value)}
        onBlur={commitTags}
        className="input-base w-full mt-2 px-2 py-1 text-xs"
      />
      <textarea
        value={noteDraft}
        placeholder={t("game.journal.notePlaceholder")}
        onChange={(e) => setNoteDraft(e.target.value)}
        onBlur={() => onSave({ note: noteDraft })}
        rows={2}
        className="input-base w-full mt-1.5 px-2 py-1 text-xs resize-none"
      />
    </div>
  );
}
