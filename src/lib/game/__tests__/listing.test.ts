import { describe, it, expect } from "vitest";
import {
  LISTING_SLOTS,
  MIN_AGE_DAYS,
  MIN_CAPITAL,
  MIN_MEMBERS,
  MIN_OWNER_CONTRACTS,
  normalizeTicker,
  SHARES_ISSUED,
} from "@/lib/game/listing";
import assetsData from "@/data/assets.json";

describe("тикер фонда", () => {
  it("три-пять заглавных латинских букв, как на настоящих биржах", () => {
    expect(normalizeTicker("abc")).toBe("ABC");
    expect(normalizeTicker("Альфа")).toBeNull();
    expect(normalizeTicker("AB")).toBeNull();
    expect(normalizeTicker("ABCDEF")).toBeNull();
  });

  it("мусор вычищается, а не отклоняется целиком", () => {
    expect(normalizeTicker(" a-b c1 ")).toBe("ABC");
  });
});

describe("слоты под листинг", () => {
  it("каждый слот есть в справочнике инструментов", () => {
    // Генератор рынка статичен: если слота нет в справочнике, у бумаги не
    // будет ни цены, ни свечей.
    const ids = new Set((assetsData as { id: string }[]).map((a) => a.id));
    for (const slot of LISTING_SLOTS) expect(ids.has(slot)).toBe(true);
  });

  it("слоты не пересекаются", () => {
    expect(new Set(LISTING_SLOTS).size).toBe(LISTING_SLOTS.length);
  });

  it("слоты волатильнее обычной акции — фонд сам торгует с плечом", () => {
    const assets = assetsData as { id: string; baseVolatility: number }[];
    const slot = assets.find((a) => a.id === LISTING_SLOTS[0])!;
    const plain = assets.find((a) => a.id === "STK_NEXTEK")!;
    expect(slot.baseVolatility).toBeGreaterThan(plain.baseVolatility);
  });
});

describe("требования к листингу", () => {
  it("заданы и осмысленны: на биржу не пускают кого попало", () => {
    // Без этих условий листинг был бы кнопкой «создать себе бумагу».
    expect(MIN_AGE_DAYS).toBeGreaterThan(0);
    expect(MIN_CAPITAL).toBeGreaterThan(0);
    expect(MIN_MEMBERS).toBeGreaterThan(1);
    expect(MIN_OWNER_CONTRACTS).toBeGreaterThan(0);
  });

  it("выпуск акций достаточно крупный, чтобы цена была осмысленной", () => {
    // Капитал в сто тысяч на миллион акций даёт балансовую цену в десять
    // центов — бумага копеечная, но торгуемая; на меньшем выпуске цена
    // получалась бы неудобной.
    expect(SHARES_ISSUED).toBeGreaterThanOrEqual(100_000);
  });
});
