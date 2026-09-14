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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Lock, Search } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { fmtUsd } from "@/lib/format";
import { isMarketOpen } from "@/lib/game/schedule";
import { useMarketClock } from "@/lib/game/useMarketClock";
import { readTerminalPrefs, writeAssetColor, writeTerminalPrefs } from "@/lib/game/terminalPrefs";
import { ASSET_COLOR_SWATCHES, unlockedColorCount } from "@/lib/game/assetColors";
import { useGameStore } from "@/store/gameStore";
import type { Asset, AssetClass } from "@/engine/entities/types";

type SortKey = "color" | "symbol" | "price" | "change";
type SortDir = "asc" | "desc";

/** Индекс цвета в палитре — «без метки» всегда в хвосте, а не путается с
 * первым цветом (индекс 0 иначе выглядел бы как «меньше всех»). */
function colorRank(colorId: string | undefined): number {
  if (colorId == null) return ASSET_COLOR_SWATCHES.length;
  const i = ASSET_COLOR_SWATCHES.findIndex((s) => s.id === colorId);
  return i < 0 ? ASSET_COLOR_SWATCHES.length : i;
}

// Метка цветом — как в TradingView: кружок слева от инструмента, свой
// маленький палитр по клику. Один цвет бесплатно, остальные шесть — по два
// за тариф в магазине (раздел «Цветные метки», engine/economy/shop.ts),
// см. lib/game/assetColors.ts.
function ColorDot({
  assetId,
  color,
  onChange,
}: {
  assetId: string;
  color: string | undefined;
  onChange: (assetId: string, color: string | null) => void;
}) {
  const { t } = useI18n();
  const ownedItemIds = useGameStore((s) => s.game.lifestyle.ownedItemIds);
  const unlocked = unlockedColorCount(ownedItemIds);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const active = ASSET_COLOR_SWATCHES.find((s) => s.id === color);

  return (
    <div ref={boxRef} className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        title={t("game.market.colorTag")}
        onClick={() => setOpen((v) => !v)}
        className="flex h-4 w-4 items-center justify-center rounded-full border border-border hover:border-border-strong"
        style={active ? { backgroundColor: active.hex, borderColor: active.hex } : undefined}
      />
      {open && (
        <div className="absolute left-0 top-5 z-30 flex items-center gap-1 rounded-lg border border-border-strong bg-surface p-1.5 shadow-2xl">
          {ASSET_COLOR_SWATCHES.map((swatch, i) => {
            const locked = i >= unlocked;
            const isActive = swatch.id === color;
            return (
              <button
                key={swatch.id}
                type="button"
                disabled={locked}
                title={locked ? t("game.market.colorLocked") : undefined}
                onClick={() => {
                  onChange(assetId, isActive ? null : swatch.id);
                  setOpen(false);
                }}
                className="relative flex h-5 w-5 items-center justify-center rounded-full disabled:opacity-30"
                style={{ backgroundColor: swatch.hex, outline: isActive ? "2px solid var(--color-fg)" : undefined, outlineOffset: 1 }}
              >
                {locked && <Lock size={9} className="text-white/90" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SortHeader({
  sortKey,
  sort,
  onClick,
  label,
  className = "",
}: {
  sortKey: SortKey;
  sort: { key: SortKey; dir: SortDir } | null;
  onClick: (key: SortKey) => void;
  label: string;
  className?: string;
}) {
  const active = sort?.key === sortKey;
  const Icon = sort?.dir === "desc" ? ArrowDown : ArrowUp;
  return (
    <button
      type="button"
      onClick={() => onClick(sortKey)}
      className={`inline-flex items-center gap-0.5 hover:text-fg ${active ? "text-fg" : ""} ${className}`}
    >
      {label}
      {active && <Icon size={9} />}
    </button>
  );
}

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

  // Цвета меток — в localStorage, как весь остальной вид терминала (см.
  // lib/game/terminalPrefs.ts). Читаем только в эффекте: страница рендерится
  // и на сервере, там localStorage нет.
  const [colors, setColors] = useState<Record<string, string>>({});
  useEffect(() => {
    setColors(readTerminalPrefs().assetColors ?? {});
  }, []);
  const setAssetColor = useCallback((assetId: string, color: string | null) => {
    writeAssetColor(assetId, color);
    setColors((prev) => {
      const next = { ...prev };
      if (color == null) delete next[assetId];
      else next[assetId] = color;
      return next;
    });
  }, []);

  const markets = useMemo(() => {
    const present = new Set(assets.map((a) => a.assetClass));
    return MARKET_ORDER.filter((cls) => present.has(cls));
  }, [assets]);

  // Пока игрок не выбрал рынок сам, показываем тот, где стоит текущий
  // инструмент: иначе, вернувшись на вкладку, он видит чужой список.
  const activeMarket = market ?? selected?.assetClass ?? markets[0];

  // Сортировка — своя на каждый рынок: порядок, удобный для акций (по
  // изменению за день), редко нужен такой же для форекса. Хранится там же,
  // где остальной вид терминала.
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir } | null>(null);
  useEffect(() => {
    setSort((readTerminalPrefs().assetSort?.[activeMarket] as { key: SortKey; dir: SortDir } | undefined) ?? null);
  }, [activeMarket]);
  const setSortBy = useCallback(
    (key: SortKey) => {
      setSort((prev) => {
        const next: { key: SortKey; dir: SortDir } =
          prev?.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" };
        const current = readTerminalPrefs();
        writeTerminalPrefs({ assetSort: { ...(current.assetSort ?? {}), [activeMarket]: next } });
        return next;
      });
    },
    [activeMarket],
  );

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = assets
      .filter((a) => a.assetClass === activeMarket)
      .filter((a) => q === "" || a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q));

    const dirMul = sort?.dir === "desc" ? -1 : 1;
    switch (sort?.key) {
      case "color":
        return filtered.sort(
          (a, b) => dirMul * (colorRank(colors[a.id]) - colorRank(colors[b.id]) || a.symbol.localeCompare(b.symbol)),
        );
      case "price":
        return filtered.sort((a, b) => dirMul * ((prices[a.id] ?? 0) - (prices[b.id] ?? 0)));
      case "change":
        return filtered.sort((a, b) => dirMul * ((dayChange[a.id] ?? 0) - (dayChange[b.id] ?? 0)));
      case "symbol":
        return filtered.sort((a, b) => dirMul * a.symbol.localeCompare(b.symbol));
      default:
        return filtered.sort((a, b) => a.symbol.localeCompare(b.symbol));
    }
  }, [assets, activeMarket, query, sort, colors, prices, dayChange]);

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

      {/* Заголовки колонок — они же кнопки сортировки. Порядок и ширины
          зеркалят строки ниже, иначе непонятно, какая стрелка к какой
          колонке относится. */}
      <div className="flex items-center gap-2 px-2.5 text-[10px] uppercase tracking-wide text-faint">
        <SortHeader sortKey="color" sort={sort} onClick={setSortBy} className="shrink-0" label={t("game.market.sort.color")} />
        <SortHeader sortKey="symbol" sort={sort} onClick={setSortBy} className="w-[72px] shrink-0" label={t("game.market.sort.symbol")} />
        <span className="min-w-0 flex-1" />
        <SortHeader sortKey="price" sort={sort} onClick={setSortBy} className="shrink-0" label={t("game.market.sort.price")} />
        <SortHeader
          sortKey="change"
          sort={sort}
          onClick={setSortBy}
          className="w-[58px] shrink-0 justify-end"
          label={t("game.market.sort.change")}
        />
      </div>

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
                <ColorDot assetId={asset.id} color={colors[asset.id]} onChange={setAssetColor} />
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
