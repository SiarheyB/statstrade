"use client";

// Композиция главного экрана — раздел 9/23.1 спеки, сужено под Фазу 1:
// PriceChart + OrderTicket + PositionsPanel, без OrderBook/NewsTicker
// (Фазы 2/3). Владеет жизненным циклом стора: init → тик → автосейв →
// сохранение при уходе со страницы (раздел 12: "автосохранение ... + при
// выходе из приложения").
import { useEffect, useState } from "react";
import { StatCard } from "@/components/StatCard";
import { useI18n } from "@/lib/i18n/provider";
import { fmtUsd } from "@/lib/format";
import { useGameStore } from "@/store/gameStore";
import PriceChart from "./PriceChart";
import OrderTicket from "./OrderTicket";
import PositionsPanel from "./PositionsPanel";
import GameDisclaimer from "./GameDisclaimer";
import GameOnboarding from "./GameOnboarding";

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
        <StatCard label={t("game.stat.style")} value={t("game.style.day")} />
        <StatCard label={t("game.stat.day")} value={String(game.gameCalendarDay + 1)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-4">
        <div className="card p-2 h-[420px]">
          <PriceChart candles={candles} currentPrice={assetId ? game.prices[assetId] : undefined} symbol={asset?.symbol ?? ""} />
        </div>
        {assetId && (
          <OrderTicket
            assets={game.activeAssets}
            selectedAssetId={assetId}
            onSelectAsset={setSelectedAssetId}
            prices={game.prices}
            balance={game.account.balance}
          />
        )}
      </div>

      <PositionsPanel positions={game.account.positions} prices={game.prices} assets={game.activeAssets} />
    </div>
  );
}
