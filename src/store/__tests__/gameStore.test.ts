import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  loadGame: vi.fn(),
  saveGame: vi.fn(),
}));
vi.mock("@/persistence/gameDb", () => ({
  loadGame: mocks.loadGame,
  saveGame: mocks.saveGame,
}));

import { useGameStore, PHASE1_ASSET_IDS, INVESTING_ASSET_IDS } from "@/store/gameStore";
import { DEFAULT_THEME_ID, freshLifestyle, getShopItem } from "@/engine/economy/shop";
import { gameTick, MONTH_MS } from "@/engine/gameLoop";
import { streakReward } from "@/engine/player/achievements";
import { TRADING_STYLE_CONFIGS } from "@/engine/entities/tradingStyleConfigs";

const ASSET_ID = PHASE1_ASSET_IDS[0];

function resetStoreToFresh() {
  useGameStore.setState((s) => ({
    ...s,
    status: "ready",
    onboardingDone: false,
    disclaimerSeen: false,
    game: {
      ...s.game,
      account: {
        ...s.game.account,
        balance: 10_000,
        equity: 10_000,
        positions: [],
        journal: [],
        skills: {},
        reputation: 0,
      },
      prices: { [ASSET_ID]: 100 },
      // setActiveStyle-тесты меняют это на другой стиль — без сброса течёт
      // в следующий тест (поймано: порядок тестов в файле влиял на результат).
      activeStyle: TRADING_STYLE_CONFIGS.day,
      lifestyle: freshLifestyle(),
      lastUpkeepMonth: 0,
    },
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.saveGame.mockResolvedValue(undefined);
  resetStoreToFresh();
});

describe("init", () => {
  it("грузит существующее сохранение, если оно есть", async () => {
    mocks.loadGame.mockResolvedValue({
      version: "1.0.0-phase1",
      savedAt: Date.now(),
      account: { ...useGameStore.getState().game.account, balance: 4242 },
      marketRegime: useGameStore.getState().game.marketRegime,
      prices: { [ASSET_ID]: 55 },
      candleHistory: {},
      activeAssetIds: PHASE1_ASSET_IDS,
      activeTradingStyle: "day",
      unlockedStyles: ["day"],
      unlockedMarkets: ["stock"],
      gameCalendarDay: 3,
      gameElapsedMs: 123_456,
      onboardingDone: true,
      disclaimerSeen: true,
    });
    await useGameStore.getState().init();
    const s = useGameStore.getState();
    // Загрузка отмечает заход и сразу платит за серию: первый день серии —
    // одна дневная награда сверх сохранённого баланса.
    expect(s.game.account.balance).toBe(4242 + streakReward(1));
    expect(s.game.streak.days).toBe(1);
    expect(s.game.prices[ASSET_ID]).toBe(55);
    expect(s.onboardingDone).toBe(true);
    expect(s.disclaimerSeen).toBe(true);
    expect(s.status).toBe("ready");
  });

  // Регрессия: гонка двух тикеров на одном источнике (вторая вкладка, либо
  // осиротевший таймер после Fast Refresh в деве) могла оставить в
  // candleHistory записи не по порядку и/или с задвоенным timestamp —
  // подчищаем при каждой загрузке, а не только когда "выглядит подозрительно".
  it("чинит неотсортированную/задвоенную историю свечей при загрузке", async () => {
    mocks.loadGame.mockResolvedValue({
      version: "1.0.0-phase1",
      savedAt: Date.now(),
      account: useGameStore.getState().game.account,
      marketRegime: useGameStore.getState().game.marketRegime,
      prices: { [ASSET_ID]: 100 },
      candleHistory: {
        [ASSET_ID]: [
          { timestamp: 180_000, open: 3, high: 3, low: 3, close: 3, volume: 0 },
          { timestamp: 60_000, open: 1, high: 1, low: 1, close: 1, volume: 0 },
          { timestamp: 120_000, open: 2, high: 2, low: 2, close: 2, volume: 0 },
          { timestamp: 60_000, open: 1.5, high: 1.5, low: 1.5, close: 1.5, volume: 0 }, // дубль бакета — последний должен победить
        ],
      },
      activeAssetIds: PHASE1_ASSET_IDS,
      activeTradingStyle: "day",
      unlockedStyles: ["day"],
      unlockedMarkets: ["stock"],
      gameCalendarDay: 0,
      gameElapsedMs: 180_000,
      onboardingDone: true,
      disclaimerSeen: true,
    });
    await useGameStore.getState().init();
    const candles = useGameStore.getState().game.candles[ASSET_ID];
    expect(candles.map((c) => c.timestamp)).toEqual([60_000, 120_000, 180_000]);
    expect(candles[0].close).toBe(1.5); // выжил ПОСЛЕДНИЙ виденный дубль, не первый
  });

  // Регрессия: gameElapsedMs раньше жёстко обнулялся при загрузке (0
  // литералом в saveToState), хотя candleHistory уже содержит метки времени
  // из прошлой партии — новые свечи начинали бы бакетироваться заново от 0
  // поверх старых, и график рисовал две дорожки друг на друге.
  it("восстанавливает gameElapsedMs из сохранения, а не обнуляет его", async () => {
    mocks.loadGame.mockResolvedValue({
      version: "1.0.0-phase1",
      savedAt: Date.now(),
      account: useGameStore.getState().game.account,
      marketRegime: useGameStore.getState().game.marketRegime,
      prices: { [ASSET_ID]: 55 },
      candleHistory: {},
      activeAssetIds: PHASE1_ASSET_IDS,
      activeTradingStyle: "day",
      unlockedStyles: ["day"],
      unlockedMarkets: ["stock"],
      gameCalendarDay: 3,
      gameElapsedMs: 987_654,
      onboardingDone: true,
      disclaimerSeen: true,
    });
    await useGameStore.getState().init();
    // Не строгое равенство: загрузка догоняет время, прошедшее с момента
    // сохранения, и между savedAt и init успевает пройти миллисекунда-другая
    // реальных часов. Проверяем то, ради чего тест и написан, — что значение
    // ВОССТАНОВЛЕНО, а не обнулено.
    const restored = useGameStore.getState().game.gameElapsedMs;
    expect(restored).toBeGreaterThanOrEqual(987_654);
    expect(restored).toBeLessThan(987_654 + 60_000);
  });

  it("persistNow сохраняет текущий gameElapsedMs (обходит save→load без потери непрерывности)", async () => {
    useGameStore.setState((s) => ({ game: { ...s.game, gameElapsedMs: 555_000 } }));
    await useGameStore.getState().persistNow();
    const saved = mocks.saveGame.mock.calls.at(-1)?.[0];
    expect(saved.gameElapsedMs).toBe(555_000);
  });

  // Регрессия: saveToState раньше жёстко брала activeAssets =
  // PHASE1_ASSET_IDS независимо от сохранения — игрок, переключившийся на
  // investing, после перезагрузки страницы снова видел только 6 тикеров
  // Фазы 1, хотя activeTradingStyle в сохранении был "investing".
  it("восстанавливает investing-активы из сохранения, а не только PHASE1_ASSET_IDS", async () => {
    mocks.loadGame.mockResolvedValue({
      version: "1.0.0-phase1",
      savedAt: Date.now(),
      account: useGameStore.getState().game.account,
      marketRegime: useGameStore.getState().game.marketRegime,
      prices: { [ASSET_ID]: 100 },
      candleHistory: {},
      activeAssetIds: [...PHASE1_ASSET_IDS, ...INVESTING_ASSET_IDS],
      activeTradingStyle: "investing",
      unlockedStyles: ["day", "investing"],
      unlockedMarkets: ["stock"],
      gameCalendarDay: 10,
      gameElapsedMs: 1_000_000,
      lastDividendQuarter: 2,
      onboardingDone: true,
      disclaimerSeen: true,
    });
    await useGameStore.getState().init();
    const s = useGameStore.getState();
    const ids = new Set(s.game.activeAssets.map((a) => a.id));
    for (const id of INVESTING_ASSET_IDS) expect(ids.has(id)).toBe(true);
    expect(s.game.activeStyle.style).toBe("investing");
    expect(s.game.lastDividendQuarter).toBe(2);
  });

  it("persistNow сохраняет lastDividendQuarter", async () => {
    useGameStore.setState((s) => ({ game: { ...s.game, lastDividendQuarter: 7 } }));
    await useGameStore.getState().persistNow();
    const saved = mocks.saveGame.mock.calls.at(-1)?.[0];
    expect(saved.lastDividendQuarter).toBe(7);
  });

  it("без сохранения создаёт свежее состояние со стартовым балансом", async () => {
    mocks.loadGame.mockResolvedValue(null);
    await useGameStore.getState().init();
    const s = useGameStore.getState();
    expect(s.game.account.balance).toBe(10_000);
    expect(s.onboardingDone).toBe(false);
    expect(s.status).toBe("ready");
  });
});

describe("openPosition", () => {
  it("отклоняет ордер дороже доступного баланса (edge case раздела 26), позиция не создаётся", () => {
    const res = useGameStore.getState().openPosition({ assetId: ASSET_ID, side: "long", size: 1000 }); // 1000*100 = 100000 > 10000
    expect(res).toEqual({ ok: false, error: "insufficient_funds" });
    expect(useGameStore.getState().game.account.positions).toHaveLength(0);
    expect(useGameStore.getState().game.account.balance).toBe(10_000);
  });

  it("отклоняет нулевой/отрицательный размер", () => {
    expect(useGameStore.getState().openPosition({ assetId: ASSET_ID, side: "long", size: 0 })).toEqual({ ok: false, error: "invalid_size" });
    expect(useGameStore.getState().openPosition({ assetId: ASSET_ID, side: "long", size: -5 })).toEqual({ ok: false, error: "invalid_size" });
  });

  it("отклоняет неизвестный/неактивный актив", () => {
    expect(useGameStore.getState().openPosition({ assetId: "NOPE", side: "long", size: 1 })).toEqual({ ok: false, error: "unknown_asset" });
  });

  it("успешно открывает позицию: резервирует entryPrice*size с баланса", () => {
    const res = useGameStore.getState().openPosition({ assetId: ASSET_ID, side: "long", size: 10, stopLoss: 90, takeProfit: 120 });
    expect(res).toEqual({ ok: true });
    const s = useGameStore.getState();
    expect(s.game.account.balance).toBe(10_000 - 100 * 10);
    expect(s.game.account.positions).toHaveLength(1);
    const p = s.game.account.positions[0];
    expect(p.entryPrice).toBe(100);
    expect(p.size).toBe(10);
    expect(p.side).toBe("long");
    expect(p.stopLoss).toBe(90);
    expect(p.takeProfit).toBe(120);
    expect(p.leverage).toBe(1);
    expect(p.closedAt).toBeUndefined();
  });
});

describe("closePosition", () => {
  it("возвращает резерв + realizedPnl на баланс и помечает позицию закрытой", () => {
    useGameStore.getState().openPosition({ assetId: ASSET_ID, side: "long", size: 10 });
    const positionId = useGameStore.getState().game.account.positions[0].id;
    // Цена выросла — фиксируем прибыль.
    useGameStore.setState((s) => ({ game: { ...s.game, prices: { ...s.game.prices, [ASSET_ID]: 110 } } }));
    useGameStore.getState().closePosition(positionId);
    const s = useGameStore.getState();
    const closed = s.game.account.positions.find((p) => p.id === positionId)!;
    expect(closed.closedAt).toBeDefined();
    expect(closed.closePrice).toBe(110);
    // Баланс = резерв 9000 + entry*size 1000 + realizedPnl(положительный, минус комиссия).
    expect(s.game.account.balance).toBeGreaterThan(9000 + 1000); // строго больше — прибыль перекрыла комиссию
    expect(s.game.account.journal).toHaveLength(1);
  });

  it("не делает ничего для уже закрытой или несуществующей позиции", () => {
    const before = useGameStore.getState().game.account.balance;
    useGameStore.getState().closePosition("does-not-exist");
    expect(useGameStore.getState().game.account.balance).toBe(before);
  });
});

describe("setStopLoss / setTakeProfit", () => {
  it("обновляют только указанную позицию", () => {
    useGameStore.getState().openPosition({ assetId: ASSET_ID, side: "long", size: 1 });
    const id = useGameStore.getState().game.account.positions[0].id;
    useGameStore.getState().setStopLoss(id, 80);
    useGameStore.getState().setTakeProfit(id, 130);
    const p = useGameStore.getState().game.account.positions[0];
    expect(p.stopLoss).toBe(80);
    expect(p.takeProfit).toBe(130);
  });
});

describe("openPosition — плечо (раздел 4.2)", () => {
  it("резервирует requiredMargin (entryPrice*size/leverage), а не полный номинал", () => {
    const res = useGameStore.getState().openPosition({ assetId: ASSET_ID, side: "long", size: 10, leverage: 5 });
    expect(res).toEqual({ ok: true });
    // requiredMargin = 100*10/5 = 200, а не 1000.
    expect(useGameStore.getState().game.account.balance).toBe(10_000 - 200);
    expect(useGameStore.getState().game.account.positions[0].leverage).toBe(5);
  });

  it("отклоняет плечо больше maxLeverage активного стиля", () => {
    // day.maxLeverage = 10.
    const res = useGameStore.getState().openPosition({ assetId: ASSET_ID, side: "long", size: 1, leverage: 50 });
    expect(res).toEqual({ ok: false, error: "invalid_leverage" });
    expect(useGameStore.getState().game.account.positions).toHaveLength(0);
  });

  it("отклоняет плечо меньше 1", () => {
    const res = useGameStore.getState().openPosition({ assetId: ASSET_ID, side: "long", size: 1, leverage: 0.5 });
    expect(res).toEqual({ ok: false, error: "invalid_leverage" });
  });

  it("без leverage в аргументах ведёт себя как раньше (leverage=1, полный номинал)", () => {
    useGameStore.getState().openPosition({ assetId: ASSET_ID, side: "long", size: 10 });
    expect(useGameStore.getState().game.account.balance).toBe(10_000 - 1000);
    expect(useGameStore.getState().game.account.positions[0].leverage).toBe(1);
  });
});

describe("closePosition — комиссия по стилю ОТКРЫТИЯ, не по текущему активному", () => {
  it("не меняется, если игрок переключил стиль между открытием и закрытием позиции", () => {
    // Открываем под day (commissionRate 0.0008).
    useGameStore.getState().openPosition({ assetId: ASSET_ID, side: "long", size: 10 });
    const id = useGameStore.getState().game.account.positions[0].id;
    // Переключаемся на scalping (commissionRate 0.0005) — ДО закрытия.
    useGameStore.getState().setActiveStyle("scalping");
    useGameStore.setState((s) => ({ game: { ...s.game, prices: { ...s.game.prices, [ASSET_ID]: 110 } } }));
    useGameStore.getState().closePosition(id);
    const closed = useGameStore.getState().game.account.positions[0];
    const expectedFees = (100 * 10 + 110 * 10) * TRADING_STYLE_CONFIGS.day.commissionRate;
    expect(closed.realizedPnl).toBeCloseTo((110 - 100) * 10 - expectedFees, 5);
  });
});

describe("setActiveStyle", () => {
  it("меняет activeStyle (и его timeAcceleration) для следующего тика", () => {
    expect(useGameStore.getState().game.activeStyle.style).toBe("day");
    useGameStore.getState().setActiveStyle("scalping");
    expect(useGameStore.getState().game.activeStyle.style).toBe("scalping");
    expect(useGameStore.getState().game.activeStyle.timeAcceleration).toBe(TRADING_STYLE_CONFIGS.scalping.timeAcceleration);
  });

  it("не открывает и не закрывает позиции сама по себе", () => {
    useGameStore.getState().openPosition({ assetId: ASSET_ID, side: "long", size: 1 });
    useGameStore.getState().setActiveStyle("swing");
    expect(useGameStore.getState().game.account.positions).toHaveLength(1);
    expect(useGameStore.getState().game.account.positions[0].closedAt).toBeUndefined();
  });

  // Регрессия: раньше setActiveStyle только подменяла activeStyle-конфиг —
  // переход на investing не добавлял 35 акций/облигаций в activeAssets, и
  // OrderTicket показывал только 6 тикеров Фазы 1, хотя investing по спеке
  // (раздел 8) требует широкий выбор для диверсификации.
  it("при переключении на investing ДОБАВЛЯЕТ его активы, не убирая старые", () => {
    // Стартовый набор — шесть акций фазы 1 плюс крипта: она открыта с
    // начала как единственный рынок, работающий в выходные.
    const before = useGameStore.getState().game.activeAssets.map((a) => a.id);
    for (const id of PHASE1_ASSET_IDS) expect(before).toContain(id);
    expect(before.some((id) => id.startsWith("CRY_"))).toBe(true);
    useGameStore.getState().setActiveStyle("investing");
    const ids = new Set(useGameStore.getState().game.activeAssets.map((a) => a.id));
    for (const id of PHASE1_ASSET_IDS) expect(ids.has(id)).toBe(true);
    for (const id of INVESTING_ASSET_IDS) expect(ids.has(id)).toBe(true);
    // Новым активам выставлена стартовая цена инструмента и пустая история
    // свечей — до первого ответа котировок с сервера. Раньше здесь у всех
    // стояла сотня, и по графику было не понять, торгуешь ты акцией или
    // золотом.
    const newlyAdded = INVESTING_ASSET_IDS.filter((id) => !PHASE1_ASSET_IDS.includes(id));
    for (const id of newlyAdded) {
      expect(useGameStore.getState().game.prices[id]).toBeGreaterThan(0);
      expect(useGameStore.getState().game.candles[id]).toEqual([]);
    }
  });

  it("повторное переключение на investing не пересоздаёт уже добавленные активы", () => {
    useGameStore.getState().setActiveStyle("investing");
    const before = useGameStore.getState().game.activeAssets;
    useGameStore.getState().setActiveStyle("day");
    useGameStore.getState().setActiveStyle("investing");
    const after = useGameStore.getState().game.activeAssets;
    expect(after).toHaveLength(before.length);
  });
});

describe("completeOnboarding / acceptDisclaimer", () => {
  it("выставляют флаги и сохраняют игру", async () => {
    useGameStore.getState().completeOnboarding();
    useGameStore.getState().acceptDisclaimer();
    expect(useGameStore.getState().onboardingDone).toBe(true);
    expect(useGameStore.getState().disclaimerSeen).toBe(true);
    // persistNow — fire-and-forget внутри экшенов; дождёмся микротаска.
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.saveGame).toHaveBeenCalled();
  });
});

describe("магазин (раздел 13)", () => {
  const CHAIR = getShopItem("gear_chair")!; // 1500, престиж 6, без порога

  it("покупка списывает деньги, даёт престиж и сразу сохраняется", async () => {
    const result = useGameStore.getState().purchaseShopItem(CHAIR.id);
    const s = useGameStore.getState();
    expect(result).toEqual({ ok: true });
    expect(s.game.account.balance).toBe(10_000 - CHAIR.price);
    expect(s.game.account.reputation).toBe(CHAIR.prestige);
    expect(s.game.lifestyle.ownedItemIds).toContain(CHAIR.id);
    // Персист без ожидания автосейва: покупка, потерянная при закрытии
    // вкладки, выглядела бы как списание денег в никуда.
    expect(mocks.saveGame).toHaveBeenCalled();
  });

  it("не продаёт дважды и не продаёт дороже баланса", () => {
    useGameStore.getState().purchaseShopItem(CHAIR.id);
    expect(useGameStore.getState().purchaseShopItem(CHAIR.id)).toEqual({ ok: false, error: "already_owned" });
    expect(useGameStore.getState().purchaseShopItem("life_yacht")).toEqual({ ok: false, error: "locked" });
    expect(useGameStore.getState().purchaseShopItem("life_studio")).toEqual({ ok: false, error: "insufficient_funds" });
  });

  it("тему можно надеть только после покупки", () => {
    useGameStore.getState().equipShopTheme("theme_gold");
    expect(useGameStore.getState().game.lifestyle.equippedThemeId).toBe(DEFAULT_THEME_ID);
    useGameStore.setState((s) => ({
      game: { ...s.game, account: { ...s.game.account, balance: 100_000 }, lifestyle: { ...s.game.lifestyle } },
    }));
    useGameStore.getState().purchaseShopItem("theme_matrix");
    expect(useGameStore.getState().game.lifestyle.equippedThemeId).toBe("theme_matrix");
    useGameStore.getState().equipShopTheme(DEFAULT_THEME_ID);
    expect(useGameStore.getState().game.lifestyle.equippedThemeId).toBe(DEFAULT_THEME_ID);
  });

  it("имя фонда обрезается по длине и чистится от пробелов", () => {
    useGameStore.getState().setFundName("   " + "я".repeat(60) + "   ");
    expect(useGameStore.getState().game.lifestyle.fundName).toHaveLength(40);
  });

  it("покупки и имя фонда переживают перезагрузку", async () => {
    useGameStore.getState().purchaseShopItem(CHAIR.id);
    useGameStore.getState().setFundName("Фонд Полярной звезды");
    const saved = mocks.saveGame.mock.calls.at(-1)![0];
    expect(saved.lifestyle.ownedItemIds).toContain(CHAIR.id);

    mocks.loadGame.mockResolvedValue(saved);
    await useGameStore.getState().init();
    const s = useGameStore.getState();
    expect(s.game.lifestyle.fundName).toBe("Фонд Полярной звезды");
    expect(s.game.lifestyle.ownedItemIds).toContain(CHAIR.id);
  });

  // Регрессия: сохранение, сделанное ДО появления магазина, не знает про
  // lastUpkeepMonth. Если начать отсчёт с нуля, первый же тик спишет плату
  // за все прожитые месяцы разом (на investing-ускорении — сотни).
  it("старое сохранение без lastUpkeepMonth не влетает в долг за всю прошлую жизнь", async () => {
    mocks.loadGame.mockResolvedValue({
      version: "1.0.0-phase1",
      savedAt: Date.now(),
      account: { ...useGameStore.getState().game.account, balance: 10_000 },
      marketRegime: useGameStore.getState().game.marketRegime,
      prices: { [ASSET_ID]: 100 },
      candleHistory: {},
      activeAssetIds: PHASE1_ASSET_IDS,
      activeTradingStyle: "investing",
      unlockedStyles: ["day"],
      unlockedMarkets: ["stock"],
      gameCalendarDay: 900,
      gameElapsedMs: 30 * MONTH_MS,
      onboardingDone: true,
      disclaimerSeen: true,
    });
    await useGameStore.getState().init();
    expect(useGameStore.getState().game.lastUpkeepMonth).toBe(30);
    expect(useGameStore.getState().game.lifestyle.ownedItemIds).toEqual([DEFAULT_THEME_ID]);
  });
});

describe("разорение и спонсор", () => {
  function wipeOut() {
    useGameStore.setState((s) => ({
      ...s,
      game: {
        ...s.game,
        sponsor: null,
        wipedOut: false,
        account: { ...s.game.account, balance: 50, equity: 50, positions: [], pendingOrders: [], journal: [] },
      },
    }));
  }

  it("движок сам замечает разорение и поднимает флаг", () => {
    wipeOut();
    const next = gameTick(1000, useGameStore.getState().game);
    expect(next.wipedOut).toBe(true);
  });

  it("принятая сделка даёт деньги, забирает репутацию и заводит долг", () => {
    wipeOut();
    useGameStore.setState((s) => ({ ...s, game: { ...s.game, wipedOut: true } }));
    const reputationBefore = useGameStore.getState().game.account.reputation;
    useGameStore.getState().acceptSponsor();
    const g = useGameStore.getState().game;
    expect(g.sponsor).not.toBeNull();
    expect(g.account.balance).toBeGreaterThan(50);
    expect(g.account.reputation).toBeLessThanOrEqual(reputationBefore);
    expect(g.wipedOut).toBe(false);
  });

  it("доля списывается с прибыльной сделки и не трогает убыточную", () => {
    wipeOut();
    useGameStore.setState((s) => ({ ...s, game: { ...s.game, wipedOut: true } }));
    useGameStore.getState().acceptSponsor();

    const withDeal = useGameStore.getState().game;
    const owedBefore = withDeal.sponsor!.owed;
    const balanceBefore = withDeal.account.balance;

    // Прибыльная сделка в журнале — спонсор берёт свою треть.
    const profitable = {
      ...withDeal,
      account: {
        ...withDeal.account,
        journal: [...withDeal.account.journal, { id: "j1", positionId: "p1", timestampClosed: Date.now(), gameDay: 0, pnl: 1000, rMultiple: 1, tags: [] }],
      },
    };
    const afterProfit = gameTick(1000, profitable);
    expect(afterProfit.sponsor!.owed).toBeCloseTo(owedBefore - 300, 0);
    expect(afterProfit.account.balance).toBeCloseTo(balanceBefore - 300, 0);

    // Убыточная — ничего не берёт.
    const losing = {
      ...afterProfit,
      account: {
        ...afterProfit.account,
        journal: [...afterProfit.account.journal, { id: "j2", positionId: "p2", timestampClosed: Date.now(), gameDay: 0, pnl: -500, rMultiple: -1, tags: [] }],
      },
    };
    const afterLoss = gameTick(1000, losing);
    expect(afterLoss.sponsor!.owed).toBeCloseTo(afterProfit.sponsor!.owed, 0);
  });

  it("одна и та же сделка не платит долю дважды", () => {
    wipeOut();
    useGameStore.setState((s) => ({ ...s, game: { ...s.game, wipedOut: true } }));
    useGameStore.getState().acceptSponsor();
    const g = useGameStore.getState().game;
    const withTrade = {
      ...g,
      account: {
        ...g.account,
        journal: [...g.account.journal, { id: "j1", positionId: "p1", timestampClosed: Date.now(), gameDay: 0, pnl: 1000, rMultiple: 1, tags: [] }],
      },
    };
    const once = gameTick(1000, withTrade);
    const twice = gameTick(1000, once);
    expect(twice.sponsor!.owed).toBe(once.sponsor!.owed);
    expect(twice.account.balance).toBeCloseTo(once.account.balance, 0);
  });

  it("отказ гасит предложение и оставляет счёт как есть", () => {
    wipeOut();
    useGameStore.setState((s) => ({ ...s, game: { ...s.game, wipedOut: true } }));
    useGameStore.getState().declineSponsor();
    const g = useGameStore.getState().game;
    expect(g.wipedOut).toBe(false);
    expect(g.sponsor).toBeNull();
    expect(g.account.balance).toBe(50);
  });
});
