"use client";

// Форма открытия позиции — раздел 9 спеки (<OrderTicket>), сужено под Фазу 1:
// без плеча (leverage всегда 1), рынок — акции. Live-расчёт стоимости и
// проверка "хватает ли баланса" — edge case раздела 26 (заявка больше
// доступного баланса отклоняется, ордер не создаётся).
import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { fmtUsd } from "@/lib/format";
import { useGameStore } from "@/store/gameStore";
import type { Asset, PositionSide } from "@/engine/entities/types";

export default function OrderTicket({
  assets,
  selectedAssetId,
  onSelectAsset,
  prices,
  balance,
}: {
  assets: Asset[];
  selectedAssetId: string;
  onSelectAsset: (id: string) => void;
  prices: Record<string, number>;
  balance: number;
}) {
  const { t } = useI18n();
  const openPosition = useGameStore((s) => s.openPosition);
  const [size, setSize] = useState("10");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<PositionSide | null>(null);

  const price = prices[selectedAssetId];
  const sizeNum = Number(size);
  const cost = Number.isFinite(sizeNum) && price != null ? sizeNum * price : 0;
  const insufficient = cost > balance;

  const slNum = stopLoss.trim() === "" ? undefined : Number(stopLoss);
  const tpNum = takeProfit.trim() === "" ? undefined : Number(takeProfit);

  function submit(side: PositionSide) {
    setError(null);
    if (!(sizeNum > 0)) {
      setError(t("game.order.errorSize"));
      return;
    }
    const res = openPosition({
      assetId: selectedAssetId,
      side,
      size: sizeNum,
      stopLoss: slNum != null && Number.isFinite(slNum) ? slNum : undefined,
      takeProfit: tpNum != null && Number.isFinite(tpNum) ? tpNum : undefined,
    });
    if (!res.ok) {
      setError(
        res.error === "insufficient_funds"
          ? t("game.order.errorFunds")
          : res.error === "invalid_size"
            ? t("game.order.errorSize")
            : t("game.order.errorAsset"),
      );
      return;
    }
    setFlash(side);
    setTimeout(() => setFlash(null), 700);
  }

  const options = useMemo(() => assets.map((a) => ({ id: a.id, label: `${a.symbol} — ${a.name}` })), [assets]);

  return (
    <div className="card p-4 space-y-3" data-testid="order-ticket">
      <div>
        <label className="text-xs text-faint block mb-1">{t("game.order.asset")}</label>
        <select
          value={selectedAssetId}
          onChange={(e) => onSelectAsset(e.target.value)}
          className="input-base w-full px-2 py-1.5 text-sm"
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {price != null && (
        <div className="text-xs text-faint">
          {t("game.order.currentPrice")}: <span className="text-fg tabular-nums font-medium">{fmtUsd(price)}</span>
        </div>
      )}

      <div>
        <label className="text-xs text-faint block mb-1">{t("game.order.size")}</label>
        <input
          type="number"
          min="0"
          step="1"
          value={size}
          onChange={(e) => setSize(e.target.value)}
          className="input-base w-full px-2 py-1.5 text-sm tabular-nums"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs text-faint block mb-1">{t("game.order.stopLoss")}</label>
          <input
            type="number"
            step="0.01"
            placeholder={t("game.order.optional")}
            value={stopLoss}
            onChange={(e) => setStopLoss(e.target.value)}
            className="input-base w-full px-2 py-1.5 text-sm tabular-nums"
          />
        </div>
        <div>
          <label className="text-xs text-faint block mb-1">{t("game.order.takeProfit")}</label>
          <input
            type="number"
            step="0.01"
            placeholder={t("game.order.optional")}
            value={takeProfit}
            onChange={(e) => setTakeProfit(e.target.value)}
            className="input-base w-full px-2 py-1.5 text-sm tabular-nums"
          />
        </div>
      </div>

      <div className="text-xs text-faint flex items-center justify-between">
        <span>{t("game.order.cost")}</span>
        <span className={`tabular-nums font-medium ${insufficient ? "text-loss" : "text-fg"}`}>{fmtUsd(cost)}</span>
      </div>

      {error && <div className="text-xs text-loss">{error}</div>}

      <div className="grid grid-cols-2 gap-2 pt-1">
        <button
          type="button"
          data-testid="buy-button"
          onClick={() => submit("long")}
          disabled={insufficient || !(sizeNum > 0) || price == null}
          className={`px-3 py-2 rounded-lg text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed ${
            flash === "long" ? "bg-profit text-white" : "bg-profit/15 text-profit hover:bg-profit/25"
          }`}
        >
          {t("game.order.buy")}
        </button>
        <button
          type="button"
          data-testid="sell-button"
          onClick={() => submit("short")}
          disabled={insufficient || !(sizeNum > 0) || price == null}
          className={`px-3 py-2 rounded-lg text-sm font-medium transition disabled:opacity-40 disabled:cursor-not-allowed ${
            flash === "short" ? "bg-loss text-white" : "bg-loss/15 text-loss hover:bg-loss/25"
          }`}
        >
          {t("game.order.sell")}
        </button>
      </div>
    </div>
  );
}
