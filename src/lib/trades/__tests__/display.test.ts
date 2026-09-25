import { describe, it, expect } from "vitest";
import { buildDisplayRows, isMergeable } from "../display";
import type { SerializedTrade } from "@/lib/types";

function tr(over: Partial<SerializedTrade> & { id: string }): SerializedTrade {
  return {
    symbol: "GBPJPY",
    base: "GBP",
    quote: "JPY",
    market: "forex",
    exchange: "mt5",
    accountId: "acc",
    side: "long",
    entryTime: "2026-09-25T11:17:51.000Z",
    exitTime: "2026-09-25T12:18:43.000Z",
    durationMs: 3652000,
    qty: 1000,
    entryPrice: 209.383,
    exitPrice: 208.731,
    grossPnl: -3.39,
    fees: 0.04,
    netPnl: -3.43,
    returnPct: 0,
    fillCount: 1,
    result: "loss",
    entryPoint: null,
    entryType: null,
    mistake: null,
    pattern: null,
    stopLoss: 208.751,
    rr: -0.2,
    note: null,
    imageUrl: null,
    imageProvider: null,
    imagePublicUrl: null,
    lots: 0.01,
    ...over,
  } as SerializedTrade;
}

// Сервер отдаёт кластер в порядке «строка-группа, затем позиции по времени».
const groupRow = tr({
  id: "acc:group:abc",
  isGroup: true,
  groupKey: "grp1",
  memberCount: 3,
  lots: 0.05,
  entryPrice: 209.3246,
  netPnl: -19.02,
  fees: 0.2,
  rr: -1,
  stopSpread: 0,
  stopMin: 208.751,
  stopMax: 208.751,
});
const members = ["m1", "m2", "m3"].map((id, i) =>
  tr({ id: `acc:${id}`, groupKey: "grp1", entryTime: `2026-09-25T11:1${i}:00.000Z` }),
);

describe("buildDisplayRows", () => {
  it("сворачивает сетку в одну строку с агрегатами", () => {
    const rows = buildDisplayRows([groupRow, ...members]);
    expect(rows).toHaveLength(1);
    expect(rows[0].trade).toBe(groupRow);
    expect(rows[0].trade.netPnl).toBeCloseTo(-19.02, 6);
  });

  it("позиции сетки уходят внутрь строки — их видно при разворачивании", () => {
    const rows = buildDisplayRows([groupRow, ...members]);
    expect(rows[0].members.map((m) => m.id)).toEqual(members.map((m) => m.id));
  });

  it("обычные сделки остаются как есть, без вложенных позиций", () => {
    const solo = tr({ id: "acc:solo" });
    expect(buildDisplayRows([solo])).toEqual([{ trade: solo, members: [] }]);
  });

  it("сохраняет порядок сделок, который прислал сервер", () => {
    const before = tr({ id: "acc:before" });
    const after = tr({ id: "acc:after" });
    const rows = buildDisplayRows([before, groupRow, ...members, after]);
    expect(rows.map((r) => r.trade.id)).toEqual([before.id, groupRow.id, after.id]);
  });

  it("участник без своей группы не теряется, а показывается отдельной строкой", () => {
    // Такого сервер не присылает (кластер идёт целиком), но молча ронять
    // сделку из выдачи нельзя.
    const orphan = tr({ id: "acc:orphan", groupKey: "missing" });
    expect(buildDisplayRows([orphan])).toEqual([{ trade: orphan, members: [] }]);
  });
});

describe("isMergeable", () => {
  it("только импортированные позиции вне группы", () => {
    expect(isMergeable(tr({ id: "acc:x" }))).toBe(true);
    expect(isMergeable(tr({ id: "acc:y", groupKey: "grp1" }))).toBe(false);
    expect(isMergeable(groupRow)).toBe(false);
    // крипта: lots нет, нетто-позиция усредняется при разборе филлов
    expect(isMergeable(tr({ id: "acc:c", lots: undefined }))).toBe(false);
  });
});
