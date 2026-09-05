import { describe, it, expect } from "vitest";
import { diagnose, MIN_TRADES } from "@/engine/player/diagnostics";
import type { JournalEntry, Position } from "@/engine/entities/types";

let seq = 0;
function trade(patch: Partial<Position> & { pnl: number; holdMin: number }): Position {
  const openedAt = 1_000_000 + seq * 60 * 60_000;
  seq++;
  return {
    id: `p${seq}`,
    assetId: "A",
    side: "long",
    entryPrice: 100,
    size: 1,
    leverage: 1,
    openedAt,
    closedAt: openedAt + patch.holdMin * 60_000,
    realizedPnl: patch.pnl,
    fees: 0,
    style: "day",
    stopLoss: 95,
    ...patch,
  };
}

const noJournal: JournalEntry[] = [];

describe("разбор сделок", () => {
  it("молчит на маленькой выборке — вывод по трём сделкам это шум, а не вывод", () => {
    seq = 0;
    const few = Array.from({ length: MIN_TRADES - 1 }, () => trade({ pnl: -100, holdMin: 60 }));
    expect(diagnose(few, noJournal)).toEqual([]);
  });

  it("замечает, что убыток держат дольше прибыли", () => {
    seq = 0;
    const positions = [
      ...Array.from({ length: 6 }, () => trade({ pnl: 100, holdMin: 10 })),
      ...Array.from({ length: 6 }, () => trade({ pnl: -100, holdMin: 90 })),
    ];
    const ids = diagnose(positions, noJournal).map((i) => i.id);
    expect(ids).toContain("holdAsymmetry");
  });

  it("не жалуется, когда прибыль держат дольше убытка", () => {
    seq = 0;
    const positions = [
      ...Array.from({ length: 6 }, () => trade({ pnl: 100, holdMin: 120 })),
      ...Array.from({ length: 6 }, () => trade({ pnl: -100, holdMin: 20 })),
    ];
    expect(diagnose(positions, noJournal).map((i) => i.id)).not.toContain("holdAsymmetry");
  });

  it("объясняет высокий винрейт при отрицательном итоге", () => {
    seq = 0;
    const positions = [
      ...Array.from({ length: 8 }, () => trade({ pnl: 50, holdMin: 30 })),
      ...Array.from({ length: 5 }, () => trade({ pnl: -200, holdMin: 30 })),
    ];
    const insight = diagnose(positions, noJournal).find((i) => i.id === "payoffGap");
    expect(insight).toBeDefined();
    expect(Number(insight!.values.winRate)).toBeGreaterThan(50);
  });

  it("считает сделки без стопа", () => {
    seq = 0;
    const positions = [
      ...Array.from({ length: 6 }, () => trade({ pnl: -100, holdMin: 30, stopLoss: undefined })),
      ...Array.from({ length: 6 }, () => trade({ pnl: 50, holdMin: 30 })),
    ];
    const insight = diagnose(positions, noJournal).find((i) => i.id === "noStop");
    expect(insight).toBeDefined();
    expect(insight!.values.share).toBe(50);
  });

  it("видит вред плеча по этому конкретному счёту, а не вообще", () => {
    seq = 0;
    const positions = [
      ...Array.from({ length: 6 }, () => trade({ pnl: -300, holdMin: 30, leverage: 10 })),
      ...Array.from({ length: 6 }, () => trade({ pnl: 100, holdMin: 30, leverage: 1 })),
    ];
    expect(diagnose(positions, noJournal, 8).map((i) => i.id)).toContain("leverageHarm");
  });

  it("хвалит сильный стиль, а не только ругает", () => {
    seq = 0;
    const positions = [
      ...Array.from({ length: 6 }, () => trade({ pnl: 200, holdMin: 30, style: "swing" })),
      ...Array.from({ length: 6 }, () => trade({ pnl: -50, holdMin: 30, style: "scalping" })),
    ];
    const insight = diagnose(positions, noJournal, 8).find((i) => i.id === "bestStyle");
    expect(insight).toBeDefined();
    expect(insight!.values.style).toBe("swing");
    expect(insight!.tone).toBe("good");
  });

  it("не вываливает всё сразу — список из десяти замечаний не меняет поведения", () => {
    seq = 0;
    const positions = [
      ...Array.from({ length: 8 }, () => trade({ pnl: 50, holdMin: 5, stopLoss: undefined, leverage: 10 })),
      ...Array.from({ length: 8 }, () => trade({ pnl: -400, holdMin: 200, stopLoss: undefined, leverage: 10 })),
    ];
    expect(diagnose(positions, noJournal).length).toBeLessThanOrEqual(4);
  });

  it("замечает концентрацию в одном инструменте, только если счёт в минусе", () => {
    seq = 0;
    const losing = Array.from({ length: 12 }, () => trade({ pnl: -50, holdMin: 30 }));
    expect(diagnose(losing, noJournal, 8).map((i) => i.id)).toContain("concentration");

    seq = 0;
    const winning = Array.from({ length: 12 }, () => trade({ pnl: 50, holdMin: 30 }));
    expect(diagnose(winning, noJournal, 8).map((i) => i.id)).not.toContain("concentration");
  });
});
