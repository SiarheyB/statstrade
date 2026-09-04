// Требует настоящий (пусть и in-memory) IndexedDB — jsdom его не даёт.
import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { deleteSave, loadGame, saveGame } from "@/persistence/gameDb";
import type { SaveGame } from "@/engine/entities/types";
import { NEUTRAL_REGIME } from "@/engine/entities/types";

function makeSave(gameElapsedMs: number, overrides: Partial<SaveGame> = {}): SaveGame {
  return {
    version: "test",
    savedAt: Date.now(),
    account: {
      id: "player",
      balance: 10000,
      equity: 10000,
      positions: [],
      pendingOrders: [],
      marginUsed: 0,
      marginLevel: Infinity,
      psychology: { stress: 0, confidence: 50, discipline: 0, consecutiveWins: 0, consecutiveLosses: 0, lastTradeAt: 0 },
      skills: {},
      reputation: 0,
      licenses: [],
      journal: [],
    },
    marketRegime: NEUTRAL_REGIME,
    prices: {},
    candleHistory: {},
    activeAssetIds: [],
    activeTradingStyle: "day",
    unlockedStyles: ["day"],
    unlockedMarkets: ["stock"],
    gameCalendarDay: 0,
    gameElapsedMs,
    onboardingDone: false,
    disclaimerSeen: false,
    ...overrides,
  };
}

// gameDb.ts кэширует соединение с БД модульным синглтоном — удалять саму
// IndexedDB-базу между тестами нельзя (соединение Dexie осталось бы висеть
// на удалённой базе). deleteSave() чистит запись через то же живое
// соединение, публичным API модуля.
beforeEach(async () => {
  await deleteSave();
});

describe("saveGame — защита от отката игрового времени назад", () => {
  it("первое сохранение проходит всегда", async () => {
    await saveGame(makeSave(1000));
    const loaded = await loadGame();
    expect(loaded?.gameElapsedMs).toBe(1000);
  });

  it("сохранение с БОЛЬШИМ gameElapsedMs перезаписывает предыдущее", async () => {
    await saveGame(makeSave(1000));
    await saveGame(makeSave(2000));
    const loaded = await loadGame();
    expect(loaded?.gameElapsedMs).toBe(2000);
  });

  it("сохранение с МЕНЬШИМ gameElapsedMs молча отклоняется (не откатывает прогресс)", async () => {
    await saveGame(makeSave(5000));
    await saveGame(makeSave(1000)); // "устаревшая" сессия — вторая вкладка/осиротевший таймер
    const loaded = await loadGame();
    expect(loaded?.gameElapsedMs).toBe(5000); // не откатилось
  });

  it("равный gameElapsedMs перезаписывает (например, обновлённый баланс на том же тике)", async () => {
    await saveGame(makeSave(3000, { account: { ...makeSave(3000).account, balance: 9000 } }));
    await saveGame(makeSave(3000, { account: { ...makeSave(3000).account, balance: 8000 } }));
    const loaded = await loadGame();
    expect(loaded?.account.balance).toBe(8000);
  });

  it("loadGame возвращает null, если сохранения ещё нет", async () => {
    expect(await loadGame()).toBeNull();
  });
});
