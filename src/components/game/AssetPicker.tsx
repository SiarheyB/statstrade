"use client";

// Выбор инструмента.
//
// Был выпадающий список с группами: тридцать акций, десять монет и дюжина
// валютных пар одним свитком, где всё выглядит одинаково и ничего не видно
// до клика. Понять, ЧТО ты торгуешь, из него было нельзя — а это первый
// вопрос, который задаёт себе трейдер.
//
// Теперь рынок выбирается кнопкой, а инструменты внутри рынка лежат
// списком с ценой и дневным изменением: выбор идёт по цифрам, а не по
// названию, которое игроку ничего не говорит.
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { fmtUsd } from "@/lib/format";
import { isMarketOpen } from "@/lib/game/schedule";
import { useMarketClock } from "@/lib/game/useMarketClock";
import type { Asset, AssetClass } from "@/engine/entities/types";

// Порядок рынков — от простого к сложному, тот же, что в наградах за
// испытания: игрок открывает их примерно в этом порядке.
const MARKET_ORDER: AssetClass[] = ["stock", "bond", "index", "crypto", "forex", "commodity"];

// Со скольких инструментов в рынке появляется поиск. Меньше десятка
// пролистываются глазами быстрее, чем набирается запрос.
const SEARCH_THRESHOLD = 10;

export default function AssetPicker({
  assets,
  selectedAssetId,
  onSelect,
  prices,
  dayChange,
}: {
  assets: Asset[];
  selectedAssetId: string;
  onSelect: (id: string) => void;
  prices: Record<string, number>;
  dayChange: Record<string, number>;
}) {
  const { t } = useI18n();
  const now = useMarketClock();
  const selected = assets.find((a) => a.id === selectedAssetId);
  const [market, setMarket] = useState<AssetClass | null>(null);
  const [query, setQuery] = useState("");

  const markets = useMemo(() => {
    const present = new Set(assets.map((a) => a.assetClass));
    return MARKET_ORDER.filter((cls) => present.has(cls));
  }, [assets]);

  // Пока игрок не выбрал рынок сам, показываем тот, где стоит текущий
  // инструмент: иначе, вернувшись на вкладку, он видит чужой список.
  const activeMarket = market ?? selected?.assetClass ?? markets[0];

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets
      .filter((a) => a.assetClass === activeMarket)
      .filter((a) => q === "" || a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q))
      .sort((a, b) => a.symbol.localeCompare(b.symbol));
  }, [assets, activeMarket, query]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {markets.map((cls) => {
          const active = cls === activeMarket;
          // Закрытый рынок помечаем прямо на кнопке: это первое, что нужно
          // знать, выбирая, чем торговать в субботу.
          const open = now > 0 ? isMarketOpen(cls, now) : true;
          return (
            <button
              key={cls}
              type="button"
              onClick={() => {
                setMarket(cls);
                setQuery("");
              }}
              title={open ? t("game.market.openNow") : t("game.market.closedNow")}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                active ? "bg-accent text-white" : "bg-surface-2 text-muted hover:text-fg"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${open ? "bg-profit" : "bg-loss/70"}`}
                aria-hidden
              />
              {t(`game.market.${cls}`)}
            </button>
          );
        })}
      </div>

      {assets.filter((a) => a.assetClass === activeMarket).length >= SEARCH_THRESHOLD && (
        <div className="relative">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-faint" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("game.market.search")}
            className="input-base w-full py-1.5 pl-7 pr-2 text-xs"
          />
        </div>
      )}

      <div className="max-h-[240px] overflow-y-auto rounded-lg border border-border">
        {items.length === 0 ? (
          <div className="px-2.5 py-3 text-xs text-faint">{t("game.market.nothingFound")}</div>
        ) : (
          items.map((asset) => {
            const active = asset.id === selectedAssetId;
            const price = prices[asset.id];
            const change = dayChange[asset.id] ?? 0;
            return (
              <button
                key={asset.id}
                type="button"
                onClick={() => onSelect(asset.id)}
                title={asset.name}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition ${
                  active ? "bg-accent/15" : "hover:bg-surface-2"
                }`}
              >
                <span className={`w-[72px] shrink-0 font-medium ${active ? "text-accent" : ""}`}>{asset.symbol}</span>
                <span className="min-w-0 flex-1 truncate text-faint">{asset.name}</span>
                <span className="shrink-0 tabular-nums">{price != null ? fmtUsd(price) : "—"}</span>
                <span className={`w-[58px] shrink-0 text-right tabular-nums ${change >= 0 ? "text-profit" : "text-loss"}`}>
                  {change >= 0 ? "+" : ""}
                  {change.toFixed(2)}%
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
