"use client";

// Форма открытия позиции — раздел 9 спеки (<OrderTicket>). Live-расчёт
// требуемой маржи (раздел 4.2) и проверка "хватает ли баланса" — edge case
// раздела 26 (заявка больше доступного баланса отклоняется, ордер не
// создаётся). Плечо ограничено maxLeverage активного стиля (раздел 5).
import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { fmtUsd } from "@/lib/format";
import { useGameStore } from "@/store/gameStore";
import { calculateRequiredMargin, calculateLiquidationPrice } from "@/engine/economy/marginEngine";
import { isMarketOpen, nextOpen } from "@/lib/game/schedule";
import { useMarketClock } from "@/lib/game/useMarketClock";
import { suggestPositionSize, DEFAULT_RISK_PER_TRADE_PCT } from "@/engine/economy/positionSizing";
import type { Asset, AssetClass, PositionSide } from "@/engine/entities/types";

export default function OrderTicket({
  assets,
  selectedAssetId,
  onSelectAsset,
  prices,
  balance,
  maxLeverage,
}: {
  assets: Asset[];
  selectedAssetId: string;
  onSelectAsset: (id: string) => void;
  prices: Record<string, number>;
  balance: number;
  maxLeverage: number;
}) {
  const { t } = useI18n();
  const openPosition = useGameStore((s) => s.openPosition);
  const placeOrder = useGameStore((s) => s.placeOrder);
  // Тип входа. Рыночный — как было; лимит ждёт отката к уровню, стоп —
  // пробоя. На закрытом рынке рыночного входа нет вовсе, и заявка остаётся
  // единственным способом подготовиться к открытию.
  const [entry, setEntry] = useState<"market" | "limit" | "stop">("market");
  const [level, setLevel] = useState("");
  const [trailing, setTrailing] = useState("");
  const [size, setSize] = useState("10");
  const [leverage, setLeverage] = useState(1);
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<PositionSide | null>(null);
  const now = useMarketClock();

  // Плечо активного стиля могло уменьшиться при переключении стиля —
  // не даём висеть значению выше нового потолка.
  const effectiveLeverage = Math.min(leverage, maxLeverage);

  const price = prices[selectedAssetId];
  const sizeNum = Number(size);
  const cost =
    Number.isFinite(sizeNum) && price != null ? calculateRequiredMargin(price, sizeNum, effectiveLeverage) : 0;
  const insufficient = cost > balance;

  const slNum = stopLoss.trim() === "" ? undefined : Number(stopLoss);
  const tpNum = takeProfit.trim() === "" ? undefined : Number(takeProfit);
  const trailNum = trailing.trim() === "" ? undefined : Number(trailing);
  const levelNum = level.trim() === "" ? undefined : Number(level);

  const asset = assets.find((a) => a.id === selectedAssetId);
  // Расписание считаем на клиенте, а не тянем с сервера: модуль чистый, а
  // открытие рынка игрок должен увидеть тогда же, когда часы на стене.
  // now === 0 до первого эффекта (SSR) — до этого момента считаем рынок
  // открытым, иначе на сервере отрисовалась бы плашка «закрыто».
  const marketOpen = asset && now > 0 ? isMarketOpen(asset.assetClass, now) : true;
  const opensAt = asset && now > 0 && !marketOpen ? nextOpen(asset.assetClass, now) : null;
  const needsLevel = entry !== "market";
  const levelReady = !needsLevel || (levelNum != null && Number.isFinite(levelNum) && levelNum > 0);
  const canSubmit = (marketOpen || needsLevel) && levelReady && !insufficient && sizeNum > 0 && price != null;

  // Подсказка по размеру позиции (раздел 4.3) — только рекомендация, не
  // ограничение: показывается, когда стоп-лосс заполнен, риск 1% от баланса.
  const suggestedSize =
    price != null && slNum != null && Number.isFinite(slNum)
      ? suggestPositionSize(balance, DEFAULT_RISK_PER_TRADE_PCT, price, slNum)
      : null;

  function submit(side: PositionSide) {
    setError(null);
    if (!(sizeNum > 0)) {
      setError(t("game.order.errorSize"));
      return;
    }
    const plan = {
      stopLoss: slNum != null && Number.isFinite(slNum) ? slNum : undefined,
      takeProfit: tpNum != null && Number.isFinite(tpNum) ? tpNum : undefined,
      trailingPct: trailNum != null && Number.isFinite(trailNum) && trailNum > 0 ? trailNum : undefined,
    };
    const res =
      entry === "market"
        ? openPosition({ assetId: selectedAssetId, side, size: sizeNum, leverage: effectiveLeverage, ...plan })
        : placeOrder({
            assetId: selectedAssetId,
            side,
            type: entry,
            size: sizeNum,
            level: levelNum!,
            leverage: effectiveLeverage,
            ...plan,
          });
    if (!res.ok) {
      setError(
        res.error === "insufficient_funds"
          ? t("game.order.errorFunds")
          : res.error === "invalid_size"
            ? t("game.order.errorSize")
            : res.error === "invalid_leverage"
              ? t("game.order.errorLeverage")
              : res.error === "wrong_side"
                ? t("game.order.errorLevelSide")
                : t("game.order.errorAsset"),
      );
      return;
    }
    setFlash(side);
    setTimeout(() => setFlash(null), 700);
  }

  // Инструменты сгруппированы по рынкам: в плоском списке из трёх десятков
  // строк было не понять, что вообще торгуешь — акция, валютная пара или
  // металл. Порядок групп фиксированный, от простого рынка к сложному.
  const MARKET_ORDER: AssetClass[] = ["stock", "bond", "index", "crypto", "forex", "commodity"];
  const groups = useMemo(() => {
    const byClass = new Map<AssetClass, { id: string; label: string }[]>();
    for (const asset of assets) {
      const list = byClass.get(asset.assetClass) ?? [];
      list.push({ id: asset.id, label: `${asset.symbol} — ${asset.name}` });
      byClass.set(asset.assetClass, list);
    }
    return MARKET_ORDER.filter((cls) => byClass.has(cls)).map((cls) => ({ cls, items: byClass.get(cls)! }));
    // MARKET_ORDER — константа модуля по смыслу, но объявлена внутри
    // компонента ради читаемости; список активов меняется редко.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assets]);

  const longLiqPrice =
    price != null && effectiveLeverage > 1 ? calculateLiquidationPrice(price, effectiveLeverage, "long") : null;
  const shortLiqPrice =
    price != null && effectiveLeverage > 1 ? calculateLiquidationPrice(price, effectiveLeverage, "short") : null;

  return (
    <div className="card p-4 space-y-3" data-testid="order-ticket">
      <div>
        <label className="text-xs text-faint block mb-1">{t("game.order.asset")}</label>
        <select
          value={selectedAssetId}
          onChange={(e) => onSelectAsset(e.target.value)}
          className="input-base w-full px-2 py-1.5 text-sm"
        >
          {groups.map((group) => (
            <optgroup key={group.cls} label={t(`game.market.${group.cls}`)}>
              {group.items.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      {price != null && (
        <div className="text-xs text-faint">
          {t("game.order.currentPrice")}: <span className="text-fg tabular-nums font-medium">{fmtUsd(price)}</span>
        </div>
      )}

      {!marketOpen && opensAt != null && (
        <div className="rounded-lg bg-surface-2 px-2.5 py-2 text-[11px] leading-relaxed text-muted">
          {t("game.order.marketClosed", {
            when: new Date(opensAt).toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" }),
          })}
        </div>
      )}

      <div className="grid grid-cols-3 gap-1 rounded-lg bg-surface-2 p-1">
        {(["market", "limit", "stop"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => setEntry(kind)}
            disabled={kind === "market" && !marketOpen}
            className={`px-2 py-1.5 rounded-md text-xs font-medium transition disabled:opacity-30 disabled:cursor-not-allowed ${
              entry === kind ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg"
            }`}
          >
            {t(`game.order.entry.${kind}`)}
          </button>
        ))}
      </div>

      {needsLevel && (
        <div>
          <label className="text-xs text-faint block mb-1">{t(`game.order.level.${entry}`)}</label>
          <input
            type="number"
            step="0.00001"
            placeholder={price != null ? String(price) : ""}
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="input-base w-full px-2 py-1.5 text-sm tabular-nums"
          />
          <div className="text-[11px] text-faint mt-1">{t(`game.order.levelHint.${entry}`)}</div>
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
        {suggestedSize != null && (
          <div className="text-[11px] text-faint mt-1">
            {t("game.order.suggestedSize", { size: suggestedSize.toFixed(2) })}
          </div>
        )}
      </div>

      {maxLeverage > 1 && (
        <div>
          <label className="text-xs text-faint flex items-center justify-between mb-1">
            <span>{t("game.order.leverage")}</span>
            <span className="text-fg font-medium tabular-nums">{effectiveLeverage}x</span>
          </label>
          <input
            type="range"
            min={1}
            max={maxLeverage}
            step={1}
            value={effectiveLeverage}
            onChange={(e) => setLeverage(Number(e.target.value))}
            className="w-full accent-accent"
          />
        </div>
      )}

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

      <div>
        <label className="text-xs text-faint block mb-1">{t("game.order.trailing")}</label>
        <input
          type="number"
          min="0"
          step="0.1"
          placeholder={t("game.order.optional")}
          value={trailing}
          onChange={(e) => setTrailing(e.target.value)}
          className="input-base w-full px-2 py-1.5 text-sm tabular-nums"
        />
        <div className="text-[11px] text-faint mt-1">{t("game.order.trailingHint")}</div>
      </div>

      {effectiveLeverage > 1 && longLiqPrice != null && shortLiqPrice != null && (
        <div className="text-[11px] text-faint space-y-0.5">
          <div>{t("game.order.liqLong", { price: fmtUsd(longLiqPrice) })}</div>
          <div>{t("game.order.liqShort", { price: fmtUsd(shortLiqPrice) })}</div>
        </div>
      )}

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
          disabled={!canSubmit}
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
          disabled={!canSubmit}
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
