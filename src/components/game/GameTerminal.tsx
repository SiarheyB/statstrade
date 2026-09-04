"use client";

// Композиция главного экрана — раздел 9/23.1 спеки. Фаза 1 дала базовый
// терминал (PriceChart + OrderTicket + PositionsPanel), Фаза 2 добавила
// переключатель стиля (Scalping/Day/Swing — меняет timeAcceleration),
// OrderBook (только scalping) и Journal с метриками портфеля. Владеет
// жизненным циклом стора: init → тик → автосейв → сохранение при уходе со
// страницы (раздел 12).
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { useI18n } from "@/lib/i18n/provider";
import { fmtUsd } from "@/lib/format";
import { useGameStore, SELECTABLE_STYLES, STARTING_BALANCE } from "@/store/gameStore";
import { xpToNextLevel } from "@/engine/player/progression";
import { activeTheme, monthlyUpkeep, traderRankKey } from "@/engine/economy/shop";
import type { TradingStyle } from "@/engine/entities/types";
import PriceChart from "./PriceChart";
import OrderTicket from "./OrderTicket";
import OrderBook from "./OrderBook";
import InvestingForecast from "./InvestingForecast";
import DiversificationPanel from "./DiversificationPanel";
import NewsFeed from "./NewsFeed";
import MarketRegimeBadge from "./MarketRegimeBadge";
import Shop from "./Shop";
import PositionsPanel from "./PositionsPanel";
import Journal from "./Journal";
import GameDisclaimer from "./GameDisclaimer";
import GameOnboarding from "./GameOnboarding";

const STYLE_LABEL_KEY: Record<TradingStyle, string> = {
  scalping: "game.style.scalping",
  day: "game.style.day",
  swing: "game.style.swing",
  investing: "game.style.investing",
  position: "game.style.day", // не выбираемы в Фазе 2/5 — ключи не используются
  algo: "game.style.day",
  arbitrage: "game.style.day",
  market_making: "game.style.day",
  options: "game.style.day",
};

export default function GameTerminal() {
  const { t } = useI18n();
  const status = useGameStore((s) => s.status);
  const init = useGameStore((s) => s.init);
  const startTicking = useGameStore((s) => s.startTicking);
  const stopTicking = useGameStore((s) => s.stopTicking);
  const persistNow = useGameStore((s) => s.persistNow);
  const disclaimerSeen = useGameStore((s) => s.disclaimerSeen);
  const onboardingDone = useGameStore((s) => s.onboardingDone);
  const game = useGameStore((s) => s.game);
  const setActiveStyle = useGameStore((s) => s.setActiveStyle);

  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  // Магазин свёрнут по умолчанию: терминал — про торговлю, покупки — то, за
  // чем приходят осознанно, и разворачивать их поверх графика на первом
  // экране незачем.
  const [shopOpen, setShopOpen] = useState(false);

  const theme = activeTheme(game.lifestyle);
  // Мемо, чтобы объект-литерал не менял идентичность на каждом тике игры
  // (~4Hz) и не гонял эффект перерисовки графика вхолостую.
  const candleColors = useMemo(
    () => (theme ? { up: theme.up, down: theme.down } : undefined),
    [theme],
  );

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    if (status !== "ready") return;
    startTicking();
    const onBeforeUnload = () => {
      void persistNow();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      stopTicking();
      window.removeEventListener("beforeunload", onBeforeUnload);
      void persistNow();
    };
  }, [status, startTicking, stopTicking, persistNow]);

  if (status !== "ready") {
    return <div className="p-6 text-sm text-faint">{t("game.loading")}</div>;
  }

  const assetId = selectedAssetId ?? game.activeAssets[0]?.id;
  const asset = game.activeAssets.find((a) => a.id === assetId);
  const candles = assetId ? (game.candles[assetId] ?? []) : [];
  const currentStyle = game.activeStyle.style;
  // "развитие трейдера" (раздел 4.5) — уровень/опыт по СТИЛЮ, которым сейчас
  // торгует игрок; у каждого стиля свой прогресс (day/scalping/swing и т.д.
  // прокачиваются отдельно, а не единым общим уровнем).
  const skill = game.account.skills[currentStyle] ?? { level: 0, xp: 0, xpToNextLevel: xpToNextLevel(0) };

  const upkeep = monthlyUpkeep(game.lifestyle);
  const rankKey = traderRankKey(game.account.reputation);

  return (
    // --color-accent подменяется купленной темой ТОЛЬКО внутри терминала:
    // Tailwind v4 читает токен из переменной, поэтому bg-accent/text-accent
    // ниже по дереву перекрашиваются сами, а остальной кабинет остаётся в
    // штатной синей схеме проекта.
    <div
      className="p-4 md:p-6 space-y-4"
      style={theme ? ({ "--color-accent": theme.accent } as React.CSSProperties) : undefined}
    >
      {!disclaimerSeen && <GameDisclaimer />}
      {disclaimerSeen && !onboardingDone && <GameOnboarding />}

      {/* Имя фонда (покупается в магазине) — заголовок терминала. Пока фонд
          не назван, строки нет вовсе, а не пустое место с плейсхолдером. */}
      {game.lifestyle.fundName && (
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold">{game.lifestyle.fundName}</span>
          <span className="text-xs text-faint">{t(`game.shop.rank.${rankKey}`)}</span>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label={t("game.stat.balance")}
          value={fmtUsd(game.account.balance)}
          hint={upkeep > 0 ? t("game.stat.upkeepHint", { amount: fmtUsd(upkeep) }) : undefined}
        />
        <StatCard
          label={t("game.stat.equity")}
          value={fmtUsd(game.account.equity)}
          tone={game.account.equity >= game.account.balance ? "profit" : "loss"}
        />
        <StatCard label={t("game.stat.day")} value={String(game.gameCalendarDay + 1)} />
        <StatCard
          label={t("game.skill.level", { level: skill.level })}
          value={`${skill.xp} / ${skill.xpToNextLevel} XP`}
          hint={t(STYLE_LABEL_KEY[currentStyle])}
        />
      </div>

      {/* Переключатель стиля — раздел 15 Фазы 2: "переключение между
          Scalping/Day/Swing меняет timeAcceleration и видимую скорость
          движения графика" (критерий приёмки раздела 16). */}
      <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-1 card p-1 w-fit">
        {SELECTABLE_STYLES.map((style) => (
          <button
            key={style}
            type="button"
            onClick={() => setActiveStyle(style)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
              currentStyle === style ? "bg-accent text-white" : "text-muted hover:text-fg"
            }`}
          >
            {t(STYLE_LABEL_KEY[style])}
          </button>
        ))}
      </div>
        {/* Режим рынка — рядом с переключателем стиля: это два главных
            «условия задачи» на экране (как быстро идёт время и какой сейчас
            рынок). */}
        <MarketRegimeBadge regime={game.marketRegime} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_300px] gap-4">
        <div className="card p-2 h-[420px]">
          <PriceChart
            candles={candles}
            currentPrice={assetId ? game.prices[assetId] : undefined}
            symbol={asset?.symbol ?? ""}
            candleColors={candleColors}
          />
        </div>
        {currentStyle === "scalping" && asset && (
          <OrderBook midPrice={assetId ? game.prices[assetId] : undefined} tickSize={asset.tickSize} />
        )}
        {currentStyle === "investing" && (
          <InvestingForecast principal={game.account.equity} assetCount={game.activeAssets.length} />
        )}
        {assetId && (
          <OrderTicket
            assets={game.activeAssets}
            selectedAssetId={assetId}
            onSelectAsset={setSelectedAssetId}
            prices={game.prices}
            balance={game.account.balance}
            maxLeverage={game.activeStyle.maxLeverage}
          />
        )}
      </div>

      <NewsFeed news={game.newsFeed} assets={game.activeAssets} gameElapsedMs={game.gameElapsedMs} />

      <PositionsPanel positions={game.account.positions} prices={game.prices} assets={game.activeAssets} />

      {/* Сводка «куда вложены средства» — только в Investing: в скальпинге
          с шестью тикерами и минутными сделками разбивка по секторам
          бессмысленна, там портфель живёт минуты. */}
      {currentStyle === "investing" && (
        <DiversificationPanel
          positions={game.account.positions}
          assets={game.activeAssets}
          prices={game.prices}
          cash={game.account.balance}
        />
      )}

      <Journal
        journal={game.account.journal}
        positions={game.account.positions}
        assets={game.activeAssets}
        startingBalance={STARTING_BALANCE}
      />

      <div className="space-y-3">
        <button
          type="button"
          onClick={() => setShopOpen((v) => !v)}
          className="flex items-center gap-2 text-sm font-medium text-muted hover:text-fg transition"
        >
          {shopOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          {t("game.shop.title")}
          <span className="text-xs text-faint">{t(`game.shop.rank.${rankKey}`)}</span>
        </button>
        {shopOpen && <Shop />}
      </div>
    </div>
  );
}
