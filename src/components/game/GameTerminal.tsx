"use client";

// Композиция экрана игры. Раньше это была одна длинная страница, на которой
// всё лежало подряд — график, тикет, позиции, метрики, журнал, магазин: к
// стакану приходилось скроллить, а главные цифры уезжали за верх экрана.
//
// Теперь как в браузерных экономических играх и в настоящих терминалах:
//   • НЕподвижная шапка-HUD (GameHeader) — деньги, день, режим рынка, опыт;
//   • переключатель стиля торговли под ней — «скорость игры»;
//   • вкладки: Терминал / Портфель / Новости / Магазин / Карьера. Каждая —
//     самостоятельный экран, а не очередной блок в бесконечной ленте.
//
// Вкладки сделаны состоянием, а НЕ отдельными роутами: движок игры живёт в
// сторе и тикает, пока смонтирован этот компонент. Отдельные страницы
// перемонтировали бы его на каждом переходе — прогресс сохранился бы (стор
// модульный), но тик и автосейв пришлось бы поднимать заново на каждом
// клике по вкладке.
//
// Владеет жизненным циклом стора: настройки баланса из админки → init →
// тик → автосейв → сохранение при уходе со страницы (раздел 12).
import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Briefcase, Globe2, Newspaper, ShoppingBag, Trophy } from "lucide-react";
import assetsData from "@/data/assets.json";
import { useI18n } from "@/lib/i18n/provider";
import { fmtUsd } from "@/lib/format";
import { readChartPrefs, writeChartPrefs, prefString } from "@/lib/chartPrefs";
import { useGameStore, SELECTABLE_STYLES, STARTING_BALANCE } from "@/store/gameStore";
import { activeTheme } from "@/engine/economy/shop";
import { perkEffects } from "@/engine/player/perks";
import type { GameTuning } from "@/engine/entities/tuning";
import type { TradingStyle } from "@/engine/entities/types";
import PriceChart from "./PriceChart";
import OrderTicket from "./OrderTicket";
import OrderBook from "./OrderBook";
import InvestingForecast from "./InvestingForecast";
import DiversificationPanel from "./DiversificationPanel";
import NewsFeed from "./NewsFeed";
import Screener from "./Screener";
import DailyTasksPanel from "./DailyTasksPanel";
import GameHeader from "./GameHeader";
import CareerPanel from "./CareerPanel";
import Achievements from "./Achievements";
import NotifyToggle from "./NotifyToggle";
import { notifyIfHidden } from "@/lib/game/desktopNotify";
import WorldPanel from "./WorldPanel";
import GameToasts from "./GameToasts";
import PlayerNameGate from "./PlayerNameGate";
import OfflineReportModal from "./OfflineReportModal";
import ContractsPanel from "./ContractsPanel";
import MarketsPanel from "./MarketsPanel";
import PerkTree from "./PerkTree";
import BotsPanel from "./BotsPanel";
import TraderOffice from "./TraderOffice";
import Shop from "./Shop";
import PositionsPanel from "./PositionsPanel";
import Journal from "./Journal";
import TradeReview from "./TradeReview";
import GameDisclaimer from "./GameDisclaimer";
import GameOnboarding from "./GameOnboarding";
import SponsorModal from "./SponsorModal";

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

const TABS = ["terminal", "portfolio", "news", "shop", "career", "world"] as const;
type Tab = (typeof TABS)[number];

const TAB_ICON: Record<Tab, typeof BarChart3> = {
  terminal: BarChart3,
  portfolio: Briefcase,
  news: Newspaper,
  shop: ShoppingBag,
  career: Trophy,
  world: Globe2,
};

// Одна запись настроек на страницу — тот же приём, что у форекса и карты
// ордеров (lib/chartPrefs.ts): вернувшись в игру, человек ждёт ту же
// вкладку и тот же инструмент, что оставил.
const PREFS_KEY = "game.settings";

// Сколько инструментов на каждом рынке — считаем один раз на модуль:
// список активов статичен.
const ALL_MARKET_COUNTS: Record<string, number> = (assetsData as { assetClass: string }[]).reduce(
  (acc, asset) => {
    acc[asset.assetClass] = (acc[asset.assetClass] ?? 0) + 1;
    return acc;
  },
  {} as Record<string, number>,
);

export default function GameTerminal({ tuning, playerName }: { tuning: GameTuning; playerName: string | null }) {
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
  const setTuning = useGameStore((s) => s.setTuning);
  const notify = useGameStore((s) => s.notify);
  const clearContractResult = useGameStore((s) => s.clearContractResult);
  const clearDailyCompleted = useGameStore((s) => s.clearDailyCompleted);
  const streakBonus = useGameStore((s) => s.streakBonus);
  const clearStreakBonus = useGameStore((s) => s.clearStreakBonus);
  const clearAchievements = useGameStore((s) => s.clearAchievements);
  const addDrawing = useGameStore((s) => s.addDrawing);
  const removeDrawing = useGameStore((s) => s.removeDrawing);
  // Длина журнала на прошлом кадре — по её приросту понимаем, что сделка
  // закрылась (движок не рассылает событий, состояние иммутабельно).
  const lastJournalLength = useRef(0);

  // Имя приходит с сервера; после сохранения в окне «представься» держим
  // его здесь, чтобы не перезагружать страницу и не терять тик игры.
  const [name, setName] = useState<string | null>(playerName);
  const [tab, setTab] = useState<Tab>("terminal");
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  // Пока настройки не прочитаны, ничего не пишем обратно — иначе первый же
  // рендер затёр бы сохранённую вкладку дефолтом (тот же гейт, что у
  // форекса: см. CLAUDE.md, раздел про панель графика).
  const [hydrated, setHydrated] = useState(false);

  const theme = activeTheme(game.lifestyle);
  // Мемо, чтобы объект-литерал не менял идентичность на каждом тике игры
  // (~4Hz) и не гонял эффект перерисовки графика вхолостую.
  const candleColors = useMemo(() => (theme ? { up: theme.up, down: theme.down } : undefined), [theme]);

  useEffect(() => {
    // Настройки баланса — ДО init(): новая партия должна создаваться уже с
    // тем стартовым капиталом, который стоит в админке.
    setTuning(tuning);
    void init();
  }, [init, setTuning, tuning]);

  useEffect(() => {
    // localStorage читаем только в эффекте: страница рендерится и на сервере.
    /* eslint-disable react-hooks/set-state-in-effect -- localStorage читается только на клиенте */
    const prefs = readChartPrefs(PREFS_KEY);
    const savedTab = prefString(prefs.tab, TABS);
    if (savedTab) setTab(savedTab);
    if (typeof prefs.assetId === "string") setSelectedAssetId(prefs.assetId);
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writeChartPrefs(PREFS_KEY, { tab, assetId: selectedAssetId });
  }, [hydrated, tab, selectedAssetId]);

  // ── Живая обратная связь ────────────────────────────────────────────────
  // Три источника событий, о которых игрок должен узнать сразу, а не по
  // изменившимся числам: закрытая сделка, завершённое испытание и деньги,
  // пришедшие из общего мира.
  useEffect(() => {
    const journal = game.account.journal;
    if (journal.length === 0) {
      lastJournalLength.current = 0;
      return;
    }
    if (journal.length <= lastJournalLength.current) {
      lastJournalLength.current = journal.length;
      return;
    }
    // Показываем только последнюю сделку: на быстрых стилях за один тик
    // может закрыться несколько, и стопка тостов ничего не сообщает.
    const entry = journal[journal.length - 1];
    lastJournalLength.current = journal.length;
    const text = t(entry.pnl >= 0 ? "game.notice.tradeWin" : "game.notice.tradeLoss", {
      amount: fmtUsd(Math.abs(entry.pnl)),
    });
    notify(entry.pnl >= 0 ? "good" : "bad", text);
    // На невидимой вкладке тост показывать некому — дублируем системным
    // уведомлением. Один тег на все сделки: десять окон подряд на скальпинге
    // это не информирование, а атака.
    notifyIfHidden(t("game.notify.tradeTitle"), text, "game-trade");
  }, [game.account.journal, notify, t]);

  useEffect(() => {
    const result = game.lastContractResult;
    if (!result) return;
    const passed = result.outcome === "passed";
    notify(
      passed ? "good" : "bad",
      t(passed ? "game.notice.contractPassed" : "game.notice.contractFailed", {
        name: t(`game.contract.${result.contractId}.name`),
        reason: t(`game.contract.outcome.${result.outcome}`),
      }),
    );
    notifyIfHidden(
      t("game.notify.contractTitle"),
      t(passed ? "game.notice.contractPassed" : "game.notice.contractFailed", {
        name: t(`game.contract.${result.contractId}.name`),
        reason: t(`game.contract.outcome.${result.outcome}`),
      }),
      "game-contract",
    );
    clearContractResult();
  }, [game.lastContractResult, notify, clearContractResult, t]);

  useEffect(() => {
    if (game.lastDailyCompleted.length === 0) return;
    const total = game.lastDailyCompleted.reduce((sum, task) => sum + task.rewardCash, 0);
    notify("good", t("game.daily.done", { count: game.lastDailyCompleted.length, amount: fmtUsd(total) }));
    clearDailyCompleted();
  }, [game.lastDailyCompleted, notify, clearDailyCompleted, t]);

  // Награда за серию заходов и новые достижения. Уведомления рисуются здесь,
  // а не в сторе: перевод живёт в компоненте.
  useEffect(() => {
    if (!streakBonus) return;
    notify("good", t("game.streak.toast", { days: streakBonus.days, amount: fmtUsd(streakBonus.amount) }));
    clearStreakBonus();
  }, [streakBonus, notify, clearStreakBonus, t]);

  useEffect(() => {
    if (game.lastAchievements.length === 0) return;
    for (const id of game.lastAchievements) {
      notify("good", t("game.achievement.toast", { name: t(`game.achievement.${id}`) }));
    }
    clearAchievements();
  }, [game.lastAchievements, notify, clearAchievements, t]);

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

  // Сохранённого инструмента может уже не быть в активном наборе (сменился
  // стиль) — откатываемся на первый доступный, иначе селектор пустой.
  const assetId = game.activeAssets.some((a) => a.id === selectedAssetId)
    ? (selectedAssetId as string)
    : game.activeAssets[0]?.id;
  const asset = game.activeAssets.find((a) => a.id === assetId);
  const currentStyle = game.activeStyle.style;
  const unreadNews = game.newsFeed.filter((n) => n.expiresAt > game.gameElapsedMs).length;
  // Стакан — в скальпинге всегда, в остальных стилях только с перком
  // «Стакан везде»: это и есть ощутимая награда за очко навыка.
  const perks = perkEffects(game.perks);
  const showOrderBook = currentStyle === "scalping" || perks.tools.orderBookAnywhere;
  const openPositionAssetIds = game.account.positions.filter((p) => !p.closedAt).map((p) => p.assetId);

  return (
    // --color-accent подменяется купленной темой ТОЛЬКО внутри терминала:
    // Tailwind v4 читает токен из переменной, поэтому bg-accent/text-accent
    // ниже по дереву перекрашиваются сами, а остальной кабинет остаётся в
    // штатной синей схеме проекта.
    <div
      className="p-4 md:p-6 space-y-4"
      style={theme ? ({ "--color-accent": theme.accent } as React.CSSProperties) : undefined}
    >
      <GameToasts />
      {/* Без имени в игру не пускаем: оно стоит в шапке и в общем рейтинге.
          Окно перекрывает всё, включая дисклеймер и обучение. */}
      {!name && <PlayerNameGate onSaved={setName} />}
      <OfflineReportModal />
      {!disclaimerSeen && <GameDisclaimer />}
      {disclaimerSeen && !onboardingDone && <GameOnboarding />}
      {/* Разорение показываем только после вводных окон: новичок, ещё не
          принявший дисклеймер, разориться не успел. */}
      {disclaimerSeen && onboardingDone && <SponsorModal />}

      <GameHeader game={game} styleLabel={t(STYLE_LABEL_KEY[currentStyle])} playerName={name} />

      <div className="flex flex-wrap items-center gap-3">
        {/* Стиль торговли — это скорость игры (timeAcceleration) и доступное
            плечо, поэтому он рядом со вкладками, а не спрятан внутри одной. */}
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

        <div className="flex flex-wrap items-center gap-1 card p-1 w-fit">
          {TABS.map((name) => {
            const Icon = TAB_ICON[name];
            return (
              <button
                key={name}
                type="button"
                onClick={() => setTab(name)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition ${
                  tab === name ? "bg-accent text-white" : "text-muted hover:text-fg"
                }`}
              >
                <Icon size={14} />
                {t(`game.tab.${name}`)}
                {name === "news" && unreadNews > 0 && (
                  <span
                    className={`rounded-full px-1.5 text-[10px] tabular-nums ${
                      tab === name ? "bg-white/20" : "bg-accent/20 text-accent"
                    }`}
                  >
                    {unreadNews}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Уведомления — справа от вкладок: игрок вспоминает о них ровно
            тогда, когда собирается уйти со страницы. */}
        <div className="ml-auto">
          <NotifyToggle />
        </div>
      </div>

      {tab === "terminal" && (
        <div className="space-y-4">
          {/* График — главный элемент экрана. Стакан (только скальпинг)
              стоит ВПЛОТНУЮ к графику справа, как DOM в биржевом терминале:
              в скальпинге по нему принимают решение вместе со свечами, а не
              «где-то ниже по странице». */}
          <div
            className={`grid grid-cols-1 gap-4 ${
              showOrderBook ? "xl:grid-cols-[minmax(0,1fr)_200px_320px]" : "xl:grid-cols-[minmax(0,1fr)_330px]"
            }`}
          >
            <div className="card p-3 h-[clamp(420px,64vh,820px)]">
              <PriceChart
                assetId={assetId}
                currentPrice={assetId ? game.prices[assetId] : undefined}
                symbol={asset?.symbol ?? ""}
                assetClass={asset?.assetClass}
                style={currentStyle}
                candleColors={candleColors}
                drawings={assetId ? (game.drawings[assetId] ?? []) : []}
                onAddDrawing={(drawing) => {
                  if (assetId) addDrawing(assetId, drawing);
                }}
                onRemoveDrawing={(id) => {
                  if (assetId) removeDrawing(assetId, id);
                }}
              />
            </div>

            {showOrderBook && asset && (
              <OrderBook midPrice={assetId ? game.prices[assetId] : undefined} tickSize={asset.tickSize} />
            )}

            <div className="space-y-4">
              <DailyTasksPanel
                daily={game.daily}
                ctx={{
                  day: game.gameCalendarDay,
                  journal: game.account.journal,
                  positions: game.account.positions,
                  assets: game.activeAssets,
                  dayStartEquity: game.dayStartEquity,
                  equity: game.account.equity,
                }}
              />
              {perks.tools.screener && (
                <Screener
                  assets={game.activeAssets}
                  prices={game.prices}
                  dayChange={game.dayChange}
                  selectedAssetId={assetId}
                  onSelect={setSelectedAssetId}
                />
              )}
              {assetId && (
                <OrderTicket
                  assets={game.activeAssets}
                  selectedAssetId={assetId}
                  onSelectAsset={setSelectedAssetId}
                  prices={game.prices}
                  balance={game.account.balance}
                  maxLeverage={
                    game.tuning.maxLeverageCap > 0
                      ? Math.min(game.activeStyle.maxLeverage, game.tuning.maxLeverageCap)
                      : game.activeStyle.maxLeverage
                  }
                />
              )}
              {currentStyle === "investing" && (
                <InvestingForecast principal={game.account.equity} assetCount={game.activeAssets.length} />
              )}
            </div>
          </div>

          {/* Открытые позиции — под графиком: они нужны ровно там, где по
              ним принимают решение (закрыть, подвинуть стоп). Полная
              история и метрики живут во вкладке «Портфель». */}
          <PositionsPanel
            positions={game.account.positions}
            prices={game.prices}
            assets={game.activeAssets}
            orders={game.account.pendingOrders}
          />
        </div>
      )}

      {tab === "portfolio" && (
        <div className="space-y-4">
          {/* Разбор — первым: он единственный говорит, что делать дальше,
              а таблицы под ним только показывают, что уже случилось. */}
          <TradeReview positions={game.account.positions} journal={game.account.journal} />
          <DiversificationPanel
            positions={game.account.positions}
            assets={game.activeAssets}
            prices={game.prices}
            cash={game.account.balance}
          />
          <PositionsPanel
            positions={game.account.positions}
            prices={game.prices}
            assets={game.activeAssets}
            orders={game.account.pendingOrders}
          />
          <Journal
            journal={game.account.journal}
            positions={game.account.positions}
            assets={game.activeAssets}
            startingBalance={game.tuning.startingBalance || STARTING_BALANCE}
          />
        </div>
      )}

      {tab === "news" && (
        <NewsFeed
          news={game.newsFeed}
          assets={game.activeAssets}
          gameElapsedMs={game.gameElapsedMs}
          expanded
          radarAssetIds={perks.tools.newsRadar ? openPositionAssetIds : undefined}
        />
      )}

      {tab === "shop" && <Shop />}

      {tab === "world" && (
        <WorldPanel
          currentAssetId={assetId}
          currentSymbol={asset?.symbol ?? ""}
          drawings={assetId ? (game.drawings[assetId] ?? []) : []}
          onOpenIdea={(id) => {
            // Чужая идея открывается в терминале: тот же инструмент, тот же
            // общий рынок.
            setSelectedAssetId(id);
            setTab("terminal");
          }}
        />
      )}

      {tab === "career" && (
        <div className="space-y-4">
          <TraderOffice lifestyle={game.lifestyle} />
          <ContractsPanel
            contracts={game.contracts}
            equity={game.account.equity}
            balance={game.account.balance}
            currentDay={game.gameCalendarDay}
          />
          <MarketsPanel
            unlocked={game.unlockedMarkets}
            assetCounts={ALL_MARKET_COUNTS}
          />
          <PerkTree perks={game.perks} skills={game.account.skills} contractPoints={game.contractPoints} />
          <BotsPanel bots={game.bots} perks={game.perks} assets={game.activeAssets} />
          <CareerPanel
            account={game.account}
            lifestyle={game.lifestyle}
            startingBalance={game.tuning.startingBalance || STARTING_BALANCE}
          />
          <Achievements unlocked={game.achievements} streak={game.streak} />
        </div>
      )}
    </div>
  );
}
