"use client";

// Панель скринера (перк PK_SCREENER): что движется прямо сейчас. Клик по
// строке переключает график на инструмент — иначе от списка мало толку.
import { useI18n } from "@/lib/i18n/provider";
import { fmtUsd } from "@/lib/format";
import { screenAssets } from "@/engine/market/screener";
import type { Asset, Candle } from "@/engine/entities/types";

export default function Screener({
  assets,
  candles,
  prices,
  selectedAssetId,
  onSelect,
}: {
  assets: Asset[];
  candles: Record<string, Candle[]>;
  prices: Record<string, number>;
  selectedAssetId: string | undefined;
  onSelect: (assetId: string) => void;
}) {
  const { t } = useI18n();
  const rows = screenAssets(assets, candles, prices).slice(0, 12);

  return (
    <div className="card p-3">
      <div className="text-sm font-medium mb-2">{t("game.screener.title")}</div>
      <div className="space-y-0.5 max-h-64 overflow-y-auto pr-1">
        {rows.map((row) => (
          <button
            key={row.assetId}
            type="button"
            onClick={() => onSelect(row.assetId)}
            className={`w-full flex items-center gap-2 rounded-md px-2 py-1 text-xs transition ${
              row.assetId === selectedAssetId ? "bg-accent/15 text-accent" : "hover:bg-surface-2"
            }`}
          >
            <span className="font-medium w-14 text-left">{row.symbol}</span>
            <span className="tabular-nums text-faint flex-1 text-left">{fmtUsd(row.price)}</span>
            <span className={`tabular-nums w-16 text-right ${row.changePct >= 0 ? "text-profit" : "text-loss"}`}>
              {row.changePct >= 0 ? "+" : ""}
              {row.changePct.toFixed(2)}%
            </span>
          </button>
        ))}
        {rows.length === 0 && <div className="text-xs text-faint">{t("game.chart.loading")}</div>}
      </div>
    </div>
  );
}
