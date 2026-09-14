import { describe, it, expect } from "vitest";
import { changedFields, diffImport, type ExistingTrade } from "@/lib/mt/reimport";
import type { ImportedTradeInput } from "@/lib/mt/to-imported";

// Числа взяты с живого отчёта MT5 (GBPCAD, тикет 31868700): сначала была
// закрыта половина позиции, через несколько дней — остаток. MT5 обе части
// показывает ОДНОЙ строкой с тем же тикетом, просто пересчитывая её.

const row = (over: Partial<ImportedTradeInput> = {}): ImportedTradeInput => ({
  accountId: "acc1",
  source: "mt5",
  externalId: "31868700",
  symbol: "GBPCAD",
  base: "GBP",
  quote: "CAD",
  market: "forex",
  side: "long",
  lots: 0.09,
  qty: 9000,
  contractSize: 100000,
  entryTime: new Date("2026-09-04T15:30:02Z"),
  exitTime: new Date("2026-09-14T13:14:22Z"),
  entryPrice: 1.86334,
  exitPrice: 1.87208,
  stopLoss: 1.8634,
  takeProfit: 1.90398,
  commission: 0.72,
  swap: 0.62,
  grossProfit: 56.7,
  netPnl: 56.6,
  pips: 87.4,
  currency: "USD",
  comment: null,
  importBatch: "batch-2",
  ...over,
});

/** Строка в базе, оставшаяся от импорта после закрытия ПЕРВОЙ половины. */
const half = (over: Partial<ExistingTrade> = {}): ExistingTrade => ({
  id: "db1",
  externalId: "31868700",
  symbol: "GBPCAD",
  side: "long",
  lots: 0.045,
  qty: 4500,
  contractSize: 100000,
  entryTime: new Date("2026-09-04T15:30:02Z"),
  exitTime: new Date("2026-09-04T16:19:00Z"),
  entryPrice: 1.86334,
  exitPrice: 1.87149,
  stopLoss: 1.8634,
  takeProfit: 1.90398,
  commission: 0.72,
  swap: 0,
  grossProfit: 34.56,
  netPnl: 33.84,
  pips: 81.5,
  comment: null,
  ...over,
});

describe("повторный импорт отчёта MetaTrader", () => {
  it("дозакрытая позиция обновляется, а не пропускается", () => {
    // Ровно тот случай, с которого всё началось: тикет знакомый, поэтому
    // прежний createMany({ skipDuplicates: true }) молча ничего не делал и
    // импорт рапортовал «0 сделок».
    const diff = diffImport([row()], [half()]);
    expect(diff.create).toHaveLength(0);
    expect(diff.unchanged).toBe(0);
    expect(diff.update).toHaveLength(1);
    expect(diff.update[0].id).toBe("db1");
  });

  it("в обновление уходит итог по ВСЕЙ позиции", () => {
    const [u] = diffImport([row()], [half()]).update;
    expect(u.data.lots).toBe(0.09);
    expect(u.data.exitPrice).toBe(1.87208);
    expect(u.data.grossProfit).toBe(56.7);
    expect(u.data.exitTime).toEqual(new Date("2026-09-14T13:14:22Z"));
  });

  it("видно, что именно изменилось", () => {
    // Список полей уходит в лог: «дозакрыли объём» и «брокер поправил своп
    // задним числом» — разные истории, и различать их нужно по логу, а не
    // по догадкам.
    const [u] = diffImport([row()], [half()]).update;
    expect(u.changed).toEqual(
      expect.arrayContaining(["lots", "qty", "exitTime", "exitPrice", "grossProfit", "netPnl"]),
    );
    expect(u.changed).not.toContain("entryPrice");
    expect(u.changed).not.toContain("side");
  });

  it("тот же отчёт второй раз ничего не трогает", () => {
    // Иначе каждая повторная загрузка переписывала бы всю историю счёта и
    // поднимала бы шум в логах на ровном месте.
    const r = row();
    const diff = diffImport([r], [{ ...half(), ...r, id: "db1" } as ExistingTrade]);
    expect(diff.update).toHaveLength(0);
    expect(diff.create).toHaveLength(0);
    expect(diff.unchanged).toBe(1);
  });

  it("незнакомый тикет по-прежнему создаётся", () => {
    const diff = diffImport([row({ externalId: "999" })], [half()]);
    expect(diff.create).toHaveLength(1);
    expect(diff.update).toHaveLength(0);
  });

  it("сделки других счетов в сравнение не попадают", () => {
    // existing роут выбирает по accountId, но правило стоит закрепить: строки
    // сопоставляются строго по тикету из переданного списка.
    const diff = diffImport([row()], [half({ externalId: "чужой" })]);
    expect(diff.create).toHaveLength(1);
    expect(diff.update).toHaveLength(0);
  });

  it("правки брокера задним числом тоже подхватываются", () => {
    // Своп начисляют за ночь переноса, и он может измениться уже после того,
    // как сделка попала в журнал.
    const r = row();
    const stored = { ...half(), ...r, id: "db1", swap: 0.2 } as ExistingTrade;
    const [u] = diffImport([r], [stored]).update;
    expect(u.changed).toEqual(["swap"]);
    expect(u.data.swap).toBe(0.62);
  });
});

describe("сравнение полей", () => {
  it("шум округления не считается изменением", () => {
    // Цены и деньги проходят через double и наш расчёт (netPnl, qty, pips),
    // поэтому байт-в-байт совпадения ждать нельзя.
    const r = row();
    const stored = { ...half(), ...r, id: "db1", netPnl: 56.6 + 1e-12 } as ExistingTrade;
    expect(changedFields(r, stored)).toEqual([]);
  });

  it("реальная копейка изменением считается", () => {
    const r = row();
    const stored = { ...half(), ...r, id: "db1", netPnl: 56.59 } as ExistingTrade;
    expect(changedFields(r, stored)).toEqual(["netPnl"]);
  });

  it("пустой комментарий и его отсутствие — одно и то же", () => {
    // Брокеры пишут сюда то "", то ничего; различать их значило бы переписывать
    // строку на каждом импорте без причины.
    const r = row({ comment: "" });
    const stored = { ...half(), ...r, id: "db1", comment: null } as ExistingTrade;
    expect(changedFields(r, stored)).toEqual([]);
  });

  it("появившийся стоп/тейк замечается", () => {
    const r = row();
    const stored = { ...half(), ...r, id: "db1", stopLoss: null } as ExistingTrade;
    expect(changedFields(r, stored)).toEqual(["stopLoss"]);
  });
});
