import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  loadGame: vi.fn(),
  saveGame: vi.fn(),
}));
vi.mock("@/persistence/gameDb", () => ({
  loadGame: mocks.loadGame,
  saveGame: mocks.saveGame,
}));

import { useGameStore, PHASE1_ASSET_IDS } from "@/store/gameStore";

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
      },
      prices: { [ASSET_ID]: 100 },
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
    expect(s.game.account.balance).toBe(4242);
    expect(s.game.prices[ASSET_ID]).toBe(55);
    expect(s.onboardingDone).toBe(true);
    expect(s.disclaimerSeen).toBe(true);
    expect(s.status).toBe("ready");
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
    expect(useGameStore.getState().game.gameElapsedMs).toBe(987_654);
  });

  it("persistNow сохраняет текущий gameElapsedMs (обходит save→load без потери непрерывности)", async () => {
    useGameStore.setState((s) => ({ game: { ...s.game, gameElapsedMs: 555_000 } }));
    await useGameStore.getState().persistNow();
    const saved = mocks.saveGame.mock.calls.at(-1)?.[0];
    expect(saved.gameElapsedMs).toBe(555_000);
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
