"use client";

// Рынок стратегий: игрок продаёт настройки своего алго-бота за игровые
// деньги, покупатель получает копию правил в свой слот.
//
// Почему копия, а не подписка: подписка потребовала бы регулярных списаний и
// учёта, а игроку добавила бы ноль. Купил — правила твои навсегда, второй раз
// ту же стратегию не продать.
//
// Автор получает деньги в очередь на получение (как проценты по займам):
// игровой баланс живёт в браузере, сервер ведёт только обязательства.
import { useCallback, useEffect, useState } from "react";
import { ShoppingCart, Upload } from "lucide-react";
import { useI18n } from "@/lib/i18n/provider";
import { symbolOf } from "@/lib/game/assetNames";
import { fmtUsd } from "@/lib/format";
import { fetchStrategies, strategies as api, type StrategyOffer } from "@/lib/game/worldClient";
import { useGameStore } from "@/store/gameStore";
import { botSlots } from "@/engine/player/algoBots";

export default function StrategyMarket() {
  const { t } = useI18n();
  const bots = useGameStore((s) => s.game.bots);
  const perks = useGameStore((s) => s.game.perks);
  const balance = useGameStore((s) => s.game.account.balance);
  const applyWorldCash = useGameStore((s) => s.applyWorldCash);
  const addBotFromStrategy = useGameStore((s) => s.addBotFromStrategy);

  const [offers, setOffers] = useState<StrategyOffer[]>([]);
  const [price, setPrice] = useState("5000");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => setOffers(await fetchStrategies()), []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const list = await fetchStrategies();
      if (alive) setOffers(list);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const slots = botSlots(perks.unlocked);
  const myBot = bots[0];

  async function publish() {
    if (!myBot) return;
    setBusy(true);
    setMessage(null);
    const result = await api.publish({
      name,
      description,
      price: Number(price),
      config: {
        strategy: myBot.strategy,
        assetId: myBot.assetId,
        riskPct: myBot.riskPct,
        stopPct: myBot.stopPct,
        takePct: myBot.takePct,
      },
    });
    setBusy(false);
    setMessage(result.ok ? t("game.strategies.published") : result.error);
    if (result.ok) {
      setName("");
      setDescription("");
      await load();
    }
  }

  async function buy(offer: StrategyOffer) {
    if (offer.price > balance) {
      setMessage(t("game.strategies.noMoney"));
      return;
    }
    setBusy(true);
    setMessage(null);
    const result = await api.buy(offer.id);
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    applyWorldCash(-result.data.price);
    // Купленные правила сразу становятся ботом — иначе покупка это просто
    // строчка в списке.
    addBotFromStrategy(result.data.config);
    setMessage(t("game.strategies.bought", { name: result.data.name }));
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 space-y-3">
        <div>
          <div className="text-sm font-medium">{t("game.strategies.publishTitle")}</div>
          <div className="text-xs text-faint">{t("game.strategies.publishHint")}</div>
        </div>

        {!myBot ? (
          <div className="text-xs text-faint">{t("game.strategies.needBot")}</div>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-[11px] text-muted block">{t("game.strategies.name")}</label>
              <input
                value={name}
                maxLength={40}
                onChange={(e) => setName(e.target.value)}
                className="input-base px-2 py-1 text-sm w-44"
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="text-[11px] text-muted block">{t("game.strategies.description")}</label>
              <input
                value={description}
                maxLength={200}
                onChange={(e) => setDescription(e.target.value)}
                className="input-base px-2 py-1 text-sm w-full"
              />
            </div>
            <div>
              <label className="text-[11px] text-muted block">{t("game.strategies.price")}</label>
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="input-base px-2 py-1 text-sm w-28 tabular-nums"
              />
            </div>
            <button
              type="button"
              disabled={busy || name.trim().length < 3}
              onClick={() => void publish()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-accent text-white disabled:opacity-40"
            >
              <Upload size={14} />
              {t("game.strategies.publish")}
            </button>
          </div>
        )}
        {message && <div className="text-xs text-accent">{message}</div>}
      </div>

      <div className="card p-4">
        <div className="text-sm font-medium mb-2">{t("game.strategies.board")}</div>
        {offers.length === 0 ? (
          <div className="text-xs text-faint">{t("game.strategies.empty")}</div>
        ) : (
          <div className="space-y-2">
            {offers.map((offer) => (
              <div key={offer.id} className="border-t border-border pt-2">
                <div className="flex flex-wrap items-baseline gap-2 text-sm">
                  <span className="font-medium">{offer.name}</span>
                  <span className="text-xs text-faint">
                    {offer.author.nickname} · {t("game.world.contracts")}: {offer.author.contractsPassed}
                  </span>
                  <span className="text-xs text-muted">
                    {t(`game.bots.strategy.${offer.config.strategy}`)} · {symbolOf(offer.config.assetId)}
                  </span>
                  <span className="ml-auto tabular-nums">{offer.price === 0 ? t("game.shop.free") : fmtUsd(offer.price)}</span>
                  {offer.owned ? (
                    <span className="text-xs text-accent">{t("game.strategies.owned")}</span>
                  ) : (
                    <button
                      type="button"
                      disabled={busy || slots === 0}
                      title={slots === 0 ? t("game.strategies.needSlot") : undefined}
                      onClick={() => void buy(offer)}
                      className="inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-40"
                    >
                      <ShoppingCart size={12} />
                      {t("game.strategies.buy")}
                    </button>
                  )}
                </div>
                {offer.description && <div className="text-xs text-faint">{offer.description}</div>}
                <div className="text-[11px] text-faint">
                  {t("game.strategies.stats", {
                    risk: offer.config.riskPct,
                    stop: offer.config.stopPct,
                    take: offer.config.takePct,
                    buyers: offer.purchases,
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
