"use client";

// Синтетический стакан — раздел 9/15 спеки: только для scalping,
// генерируется отдельно от price engine (engine/market/orderBook.ts),
// декоративный/атмосферный — ордера по нему не исполняются (см. комментарий
// в orderBook.ts).
import { useMemo } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { fmtUsd } from "@/lib/format";
import { generateSyntheticOrderBook } from "@/engine/market/orderBook";
import { liveRng } from "@/engine/rng";

export default function OrderBook({ midPrice, tickSize }: { midPrice: number | undefined; tickSize: number }) {
  const { t } = useI18n();
  // Пересоздаём при каждом изменении цены (родитель ре-рендерится ~4Hz вместе
  // с тиком движка) — своя "живая" псевдо-ликвидность, не застывшая картинка.
  const book = useMemo(() => {
    if (midPrice == null) return null;
    return generateSyntheticOrderBook(midPrice, tickSize, 10, liveRng());
  }, [midPrice, tickSize]);

  if (!book) return null;

  const maxSize = Math.max(...book.bids.map((b) => b.size), ...book.asks.map((a) => a.size), 1);

  return (
    <div className="card p-3 w-full h-full flex flex-col overflow-hidden">
      <div className="text-[11px] uppercase tracking-wide text-faint mb-2 shrink-0">{t("game.orderBook.title")}</div>
      {/* Продавцы сверху, покупатели снизу, спред посередине — как в любом
          настоящем стакане. Обе половины делят высоту поровну и тянутся до
          низа колонки: стакан стоит вровень с графиком, а не обрывается на
          трети его высоты. */}
      <div className="flex flex-1 flex-col justify-end gap-0.5 overflow-hidden">
        {[...book.asks].reverse().map((level, i) => (
          <Row key={`ask-${i}`} price={level.price} size={level.size} maxSize={maxSize} tone="loss" />
        ))}
      </div>
      <div className="h-px bg-border my-1.5 shrink-0" />
      <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
        {book.bids.map((level, i) => (
          <Row key={`bid-${i}`} price={level.price} size={level.size} maxSize={maxSize} tone="profit" />
        ))}
      </div>
    </div>
  );
}

function Row({ price, size, maxSize, tone }: { price: number; size: number; maxSize: number; tone: "profit" | "loss" }) {
  const pct = Math.max(4, Math.round((size / maxSize) * 100));
  return (
    <div className="relative flex items-center justify-between text-[11px] tabular-nums px-1 py-0.5 rounded overflow-hidden">
      <div
        className={`absolute inset-y-0 right-0 ${tone === "profit" ? "bg-profit/10" : "bg-loss/10"}`}
        style={{ width: `${pct}%` }}
      />
      <span className={`relative ${tone === "profit" ? "text-profit" : "text-loss"}`}>{fmtUsd(price)}</span>
      <span className="relative text-faint">{size.toFixed(2)}</span>
    </div>
  );
}
