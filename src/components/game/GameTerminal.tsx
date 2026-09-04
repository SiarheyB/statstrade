"use client";

// Композиция главного экрана — раздел 9/23.1 спеки. Фаза 1 дала базовый
// терминал (PriceChart + OrderTicket + PositionsPanel), Фаза 2 добавила
// переключатель стиля (Scalping/Day/Swing — меняет timeAcceleration),
// OrderBook (только scalping) и Journal с метриками портфеля. Владеет
// жизненным циклом стора: init → тик → автосейв → сохранение при уходе со
// страницы (раздел 12).
import { useEffect, useState } from "react";
import { StatCard } from "@/components/StatCard";
import { useI18n } from "@/lib/i18n/provider";
import { fmtUsd } from "@/lib/format";
import { useGameStore, SELECTABLE_STYLES, STARTING_BALANCE } from "@/store/gameStore";
import { xpToNextLevel } from "@/engine/player/progression";
import type { TradingStyle } from "@/engine/entities/types";
import PriceChart from "./PriceChart";
import OrderTicket from "./OrderTicket";
import OrderBook from "./OrderBook";
import PositionsPanel from "./PositionsPanel";
import Journal from "./Journal";
import GameDisclaimer from "./GameDisclaimer";
import GameOnboarding from "./GameOnboarding";

const STYLE_LABEL_KEY: Record<TradingStyle, string> = {
  scalping: "game.style.scalping",
  day: "game.style.day",
  swing: "game.style.swing",
  position: "game.style.day", // не выбираемы в Фазе 2 — ключи не используются
  investing: "game.style.day",
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

  return (
    <div className="p-4 md:p-6 space-y-4">
      {!disclaimerSeen && <GameDisclaimer />}
      {disclaimerSeen && !onboardingDone && <GameOnboarding />}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label={t("game.stat.balance")} value={fmtUsd(game.account.balance)} />
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

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_300px] gap-4">
        <div className="card p-2 h-[420px]">
          <PriceChart candles={candles} currentPrice={assetId ? game.prices[assetId] : undefined} symbol={asset?.symbol ?? ""} />
        </div>
        {currentStyle === "scalping" && asset && (
          <OrderBook midPrice={assetId ? game.prices[assetId] : undefined} tickSize={asset.tickSize} />
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

      <PositionsPanel positions={game.account.positions} prices={game.prices} assets={game.activeAssets} />

      <Journal
        journal={game.account.journal}
        positions={game.account.positions}
        assets={game.activeAssets}
        startingBalance={STARTING_BALANCE}
      />
    </div>
  );
}
