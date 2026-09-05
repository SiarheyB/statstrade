"use client";

// Таблица позиций — раздел 9 спеки (<PositionsPanel>): открытые (live
// unrealized PnL) + история закрытых. PnL всегда через calculateUnrealizedPnl
// движка (раздел 17: «UI никогда не вызывает формулы напрямую» — здесь речь
// про то же самое: одна формула, а не пересчёт вручную в компоненте).
import { useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { fmtUsd } from "@/lib/format";
import { calculateUnrealizedPnl } from "@/engine/economy/pnlCalculator";
import { useGameStore } from "@/store/gameStore";
import { HintLabel } from "./Hint";
import { triggerLevel } from "@/engine/player/pendingOrders";
import type { Asset, Order, Position } from "@/engine/entities/types";

function symbolFor(assets: Asset[], assetId: string): string {
  return assets.find((a) => a.id === assetId)?.symbol ?? assetId;
}

// Инлайн-редактор SL/TP на УЖЕ открытой позиции (не на новом ордере — тем
// занимается OrderTicket). Локальное состояние стора, апдейт синхронный и
// бесплатный (в отличие от debounce-полей на /dashboard/trades, которые
// пишут на сервер) — коммитим сразу по blur/Enter, без задержки.
function StopField({ value, onSave }: { value: number | undefined; onSave: (v: number | undefined) => void }) {
  const [draft, setDraft] = useState(value != null ? String(value) : "");
  function commit() {
    const trimmed = draft.trim();
    const n = trimmed === "" ? undefined : Number(trimmed);
    onSave(n != null && Number.isFinite(n) ? n : undefined);
  }
  return (
    <input
      type="number"
      step="0.01"
      value={draft}
      placeholder="—"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      className="input-base w-20 px-1.5 py-1 text-xs tabular-nums text-right"
    />
  );
}

export default function PositionsPanel({
  positions,
  prices,
  assets,
  orders = [],
}: {
  positions: Position[];
  prices: Record<string, number>;
  assets: Asset[];
  orders?: Order[];
}) {
  const { t } = useI18n();
  const closePosition = useGameStore((s) => s.closePosition);
  const setStopLoss = useGameStore((s) => s.setStopLoss);
  const setTakeProfit = useGameStore((s) => s.setTakeProfit);
  const setTrailing = useGameStore((s) => s.setTrailing);
  const cancelOrder = useGameStore((s) => s.cancelOrder);
  const [tab, setTab] = useState<"open" | "orders" | "history">("open");

  const open = positions.filter((p) => !p.closedAt);
  const history = positions.filter((p) => p.closedAt).sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));

  return (
    <div className="card p-4">
      <div className="flex items-center gap-1 mb-3 border-b border-border">
        {(["open", "orders", "history"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`px-3 py-2 text-sm font-medium transition relative ${
              tab === k ? "text-accent" : "text-muted hover:text-fg"
            }`}
          >
            {k === "open" ? t("game.positions.open") : k === "orders" ? t("game.positions.orders") : t("game.positions.history")}
            {k === "open" && open.length > 0 && <span className="ml-1.5 text-xs text-faint">({open.length})</span>}
            {k === "orders" && orders.length > 0 && <span className="ml-1.5 text-xs text-faint">({orders.length})</span>}
            {tab === k && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent rounded-full" />}
          </button>
        ))}
      </div>

      {tab === "open" ? (
        open.length === 0 ? (
          <div className="text-sm text-faint py-6 text-center">{t("game.positions.empty")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-faint">
                  <th className="font-medium pb-2 pr-3">{t("game.positions.asset")}</th>
                  <th className="font-medium pb-2 pr-3">
                    <HintLabel text={t("game.tip.side")}>{t("game.positions.side")}</HintLabel>
                  </th>
                  <th className="font-medium pb-2 pr-3 text-right">
                    <HintLabel text={t("game.tip.size")}>{t("game.positions.size")}</HintLabel>
                  </th>
                  <th className="font-medium pb-2 pr-3 text-right">{t("game.positions.entry")}</th>
                  <th className="font-medium pb-2 pr-3 text-right">{t("game.positions.current")}</th>
                  <th className="font-medium pb-2 pr-3 text-right">
                    <HintLabel text={t("game.tip.stopLoss")}>{t("game.positions.stopLoss")}</HintLabel>
                  </th>
                  <th className="font-medium pb-2 pr-3 text-right">
                    <HintLabel text={t("game.tip.takeProfit")}>{t("game.positions.takeProfit")}</HintLabel>
                  </th>
                  <th className="font-medium pb-2 pr-3 text-right">
                    <HintLabel text={t("game.order.trailingHint")}>{t("game.positions.trailing")}</HintLabel>
                  </th>
                  <th className="font-medium pb-2 pr-3 text-right">
                    <HintLabel text={t("game.tip.pnl")}>{t("game.positions.pnl")}</HintLabel>
                  </th>
                  <th className="font-medium pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {open.map((p) => {
                  const price = prices[p.assetId];
                  const pnl = price != null ? calculateUnrealizedPnl(p, price) : 0;
                  return (
                    <tr key={p.id}>
                      <td className="py-2 pr-3 font-medium">{symbolFor(assets, p.assetId)}</td>
                      <td className="py-2 pr-3">
                        <span className={p.side === "long" ? "text-profit" : "text-loss"}>
                          {p.side === "long" ? t("game.side.long") : t("game.side.short")}
                        </span>
                        {p.leverage > 1 && <span className="text-faint text-[11px] ml-1">×{p.leverage}</span>}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{p.size}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtUsd(p.entryPrice)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{price != null ? fmtUsd(price) : "—"}</td>
                      <td className="py-2 pr-3 text-right">
                        <StopField value={p.stopLoss} onSave={(v) => setStopLoss(p.id, v)} />
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <StopField value={p.takeProfit} onSave={(v) => setTakeProfit(p.id, v)} />
                      </td>
                      <td className="py-2 pr-3 text-right">
                        <StopField value={p.trailingPct} onSave={(v) => setTrailing(p.id, v)} />
                      </td>
                      <td className={`py-2 pr-3 text-right tabular-nums font-medium ${pnl >= 0 ? "text-profit" : "text-loss"}`}>
                        {fmtUsd(pnl, { sign: true })}
                      </td>
                      <td className="py-2 text-right whitespace-nowrap">
                        {/* Половина — самая частая доля фиксации: снять риск,
                            оставить остаток бежать. Отдельная кнопка вместо
                            поля ввода именно поэтому. */}
                        <button
                          type="button"
                          onClick={() => closePosition(p.id, 0.5)}
                          title={t("game.positions.closeHalfHint")}
                          className="input-base px-2 py-1 text-xs hover:border-border-strong mr-1"
                        >
                          ½
                        </button>
                        <button
                          type="button"
                          onClick={() => closePosition(p.id)}
                          className="input-base px-2 py-1 text-xs hover:border-border-strong"
                        >
                          {t("game.positions.close")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : tab === "orders" ? (
        orders.length === 0 ? (
          <div className="text-sm text-faint py-6 text-center">{t("game.positions.emptyOrders")}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-faint">
                  <th className="font-medium pb-2 pr-3">{t("game.positions.asset")}</th>
                  <th className="font-medium pb-2 pr-3">{t("game.positions.orderType")}</th>
                  <th className="font-medium pb-2 pr-3">{t("game.positions.side")}</th>
                  <th className="font-medium pb-2 pr-3 text-right">{t("game.positions.size")}</th>
                  <th className="font-medium pb-2 pr-3 text-right">{t("game.positions.orderLevel")}</th>
                  <th className="font-medium pb-2 pr-3 text-right">{t("game.positions.current")}</th>
                  <th className="font-medium pb-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {orders.map((o) => {
                  const price = prices[o.assetId];
                  const level = triggerLevel(o);
                  return (
                    <tr key={o.id}>
                      <td className="py-2 pr-3 font-medium">{symbolFor(assets, o.assetId)}</td>
                      <td className="py-2 pr-3 text-muted">{t(`game.order.entry.${o.type}`)}</td>
                      <td className="py-2 pr-3">
                        <span className={o.side === "long" ? "text-profit" : "text-loss"}>
                          {o.side === "long" ? t("game.side.long") : t("game.side.short")}
                        </span>
                        {(o.leverage ?? 1) > 1 && <span className="text-faint text-[11px] ml-1">×{o.leverage}</span>}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{o.size}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{level != null ? fmtUsd(level) : "—"}</td>
                      <td className="py-2 pr-3 text-right tabular-nums text-muted">{price != null ? fmtUsd(price) : "—"}</td>
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          onClick={() => cancelOrder(o.id)}
                          className="input-base px-2 py-1 text-xs hover:border-border-strong"
                        >
                          {t("game.positions.cancelOrder")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : history.length === 0 ? (
        <div className="text-sm text-faint py-6 text-center">{t("game.positions.emptyHistory")}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-faint">
                <th className="font-medium pb-2 pr-3">{t("game.positions.asset")}</th>
                <th className="font-medium pb-2 pr-3">{t("game.positions.side")}</th>
                <th className="font-medium pb-2 pr-3 text-right">{t("game.positions.entry")}</th>
                <th className="font-medium pb-2 pr-3 text-right">{t("game.positions.exit")}</th>
                <th className="font-medium pb-2 text-right">{t("game.positions.pnl")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {history.map((p) => (
                <tr key={p.id}>
                  <td className="py-2 pr-3 font-medium">{symbolFor(assets, p.assetId)}</td>
                  <td className="py-2 pr-3">
                    <span className={p.side === "long" ? "text-profit" : "text-loss"}>
                      {p.side === "long" ? t("game.side.long") : t("game.side.short")}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmtUsd(p.entryPrice)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{p.closePrice != null ? fmtUsd(p.closePrice) : "—"}</td>
                  <td
                    className={`py-2 text-right tabular-nums font-medium ${
                      (p.realizedPnl ?? 0) >= 0 ? "text-profit" : "text-loss"
                    }`}
                  >
                    {fmtUsd(p.realizedPnl ?? 0, { sign: true })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
