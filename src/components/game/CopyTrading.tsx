"use client";

// Копитрейдинг: подписка на сигналы других игроков.
//
// Фонды и рынок стратегий дают участвовать в мире тем, кто торгует. Тем, кто
// торговать сам не хочет или пока не умеет, участвовать было нечем — а это
// половина пришедших.
//
// ПОЧЕМУ СИГНАЛЫ, А НЕ ЗЕРКАЛО. Сделки живут в браузере, сервер их не видит и
// скопировать позицию один в один не может. Но и не должен: слепое зеркало
// переносит на подписчика чужой размер риска, а размер обязан оставаться
// решением того, кто рискует своими деньгами. Ведущий публикует, ЧТО он
// открыл; подписчик открывает то же сам, своим объёмом, одной кнопкой.
import { useCallback, useEffect, useState } from "react";
import { Copy, Radio, UserPlus, UserMinus } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { fmtUsd } from "@/lib/format";
import { fetchSignals, signals as api, type SignalLeader, type TradeSignal } from "@/lib/game/worldClient";
import { symbolOf } from "@/lib/game/assetNames";
import { useGameStore } from "@/store/gameStore";
import { MIN_SIGNAL_FEE_PCT, MAX_SIGNAL_FEE_PCT } from "@/lib/game/copytrading";

export default function CopyTrading() {
  const { t } = useI18n();
  const openPosition = useGameStore((s) => s.openPosition);
  const prices = useGameStore((s) => s.game.prices);
  const balance = useGameStore((s) => s.game.account.balance);
  const notify = useGameStore((s) => s.notify);

  const [leaders, setLeaders] = useState<SignalLeader[]>([]);
  const [feed, setFeed] = useState<TradeSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [feePct, setFeePct] = useState(20);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const data = await fetchSignals();
    if (data) {
      setLeaders(data.leaders);
      setFeed(data.signals);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    // Лента сигналов живёт минутами: сигнал часовой давности повторять уже
    // поздно, поэтому обновляем чаще, чем остальной мир.
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      void load();
    }, 30_000);
    return () => clearInterval(timer);
  }, [load]);

  async function act(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setMessage(null);
    const result = await fn();
    if (!result.ok) setMessage(result.error ?? null);
    await load();
    setBusy(false);
  }

  /** Повторить сигнал своим размером: риск 1% баланса до стопа. */
  function copy(signal: TradeSignal) {
    const price = prices[signal.assetId];
    if (price == null) {
      setMessage(t("game.copy.noPrice"));
      return;
    }
    const side = signal.side === "short" ? "short" : "long";
    const stopPct = signal.stopPct ?? null;
    // Размер считаем от СВОЕГО риска, а не от размера ведущего: у него другой
    // счёт, и повторять его объём значит копировать чужой риск.
    const riskMoney = balance * 0.01;
    const size = stopPct && stopPct > 0 ? riskMoney / (price * (stopPct / 100)) : riskMoney / price;
    if (!(size > 0)) {
      setMessage(t("game.copy.noMoney"));
      return;
    }
    const result = openPosition({
      assetId: signal.assetId,
      side,
      size,
      stopLoss: stopPct ? price * (1 - (stopPct / 100) * (side === "long" ? 1 : -1)) : undefined,
      takeProfit: signal.takePct
        ? price * (1 + (signal.takePct / 100) * (side === "long" ? 1 : -1))
        : undefined,
      copiedFrom: signal.author.id,
      copyFeePct: signal.feePct,
    });
    if (!result.ok) {
      setMessage(t("game.copy.failed"));
      return;
    }
    notify("good", t("game.copy.copied", { symbol: symbolOf(signal.assetId), author: signal.author.nickname }));
  }

  if (loading) return <div className="card p-4 text-xs text-faint">{t("game.world.loading")}</div>;

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <div>
          <div className="inline-flex items-center gap-2 text-sm font-medium">
            <Radio size={15} className="text-accent" />
            {t("game.copy.beLeader")}
          </div>
          <p className="mt-1 text-[11px] text-faint max-w-prose">{t("game.copy.beLeaderHint")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-muted">
            {t("game.copy.fee")}
            <input
              type="number"
              min={MIN_SIGNAL_FEE_PCT}
              max={MAX_SIGNAL_FEE_PCT}
              value={feePct}
              onChange={(e) => setFeePct(Number(e.target.value))}
              className="input-base ml-2 w-20 px-2 py-1 text-sm tabular-nums"
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void act(() => api.open(feePct))}
            className="px-3 py-1.5 rounded-lg text-sm font-medium bg-accent text-white disabled:opacity-40"
          >
            {t("game.copy.openSignals")}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void act(() => api.close())}
            className="input-base px-3 py-1.5 text-sm hover:border-border-strong disabled:opacity-40"
          >
            {t("game.copy.closeSignals")}
          </button>
          {message && <span className="text-xs text-loss">{message}</span>}
        </div>
      </div>

      <div className="card p-4 space-y-2">
        <div className="text-sm font-medium">{t("game.copy.leaders")}</div>
        {leaders.length === 0 ? (
          <div className="text-xs text-faint">{t("game.copy.noLeaders")}</div>
        ) : (
          leaders.map((leader) => (
            <div key={leader.id} className="flex flex-wrap items-center gap-2 border-t border-border pt-2 text-sm">
              <span className="font-medium">{leader.nickname}</span>
              <span className="text-xs text-faint">
                {t("game.world.contracts")}: {leader.contractsPassed} · {t("game.copy.followers", { count: leader.followers })}
              </span>
              <span className="text-xs text-muted">{t("game.copy.feeIs", { pct: leader.feePct })}</span>
              <span className="ml-auto flex items-center gap-1.5">
                {leader.subscribed ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void act(() => api.unsubscribe(leader.id))}
                    className="input-base inline-flex items-center gap-1 px-2.5 py-1 text-xs hover:border-border-strong disabled:opacity-40"
                  >
                    <UserMinus size={12} />
                    {t("game.copy.unsubscribe")}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void act(() => api.subscribe(leader.id, false))}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-40"
                  >
                    <UserPlus size={12} />
                    {t("game.copy.subscribe")}
                  </button>
                )}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="card p-4 space-y-2">
        <div className="text-sm font-medium">{t("game.copy.feed")}</div>
        <p className="text-[11px] text-faint max-w-prose">{t("game.copy.feedHint")}</p>
        {feed.length === 0 ? (
          <div className="text-xs text-faint">{t("game.copy.noSignals")}</div>
        ) : (
          feed.map((signal) => (
            <div key={signal.id} className="flex flex-wrap items-center gap-2 border-t border-border pt-2 text-sm">
              <span className="text-faint tabular-nums text-xs w-[46px]">
                {new Date(signal.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
              </span>
              <span className="text-xs text-muted w-[100px] truncate">{signal.author.nickname}</span>
              <span className="font-medium w-[72px]">{symbolOf(signal.assetId)}</span>
              <span className={signal.side === "long" ? "text-profit" : "text-loss"}>
                {signal.side === "long" ? t("game.side.long") : t("game.side.short")}
              </span>
              <span className="text-xs text-faint tabular-nums">{fmtUsd(signal.price)}</span>
              <button
                type="button"
                onClick={() => copy(signal)}
                className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-accent/15 text-accent hover:bg-accent/25"
              >
                <Copy size={12} />
                {t("game.copy.repeat")}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
