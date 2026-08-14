import { describe, it, expect } from "vitest";
import { translateEventTitle, explainEvent } from "@/lib/econcalTerms";

describe("translateEventTitle", () => {
  it("leaves English titles untouched", () => {
    expect(translateEventTitle("Core CPI m/m", "en")).toBe("Core CPI m/m");
  });

  // Реальные названия из фида ForexFactory (взяты из БД).
  const cases: [string, string][] = [
    ["CPI y/y", "ИПЦ (г/г)"],
    ["Core CPI m/m", "Базовый ИПЦ (м/м)"],
    ["Core Retail Sales m/m", "Базовые розничные продажи (м/м)"],
    ["Unemployment Claims", "Заявки на пособие по безработице"],
    ["Crude Oil Inventories", "Запасы сырой нефти"],
    ["Cash Rate", "Решение по ключевой ставке"],
    ["Trade Balance", "Торговый баланс"],
    // страна впереди, модификатор и период — в хвост
    ["German Final CPI m/m", "ИПЦ (оконч., Германия, м/м)"],
    ["Flash GDP q/q", "ВВП (предв., кв/кв)"],
    ["Italian Trade Balance", "Торговый баланс (Италия)"],
    // организация-источник
    ["RBA Rate Statement", "Заявление по ставке (РБА)"],
    ["CB Leading Index m/m", "Индекс опережающих индикаторов (Conference Board, м/м)"],
    ["Prelim UoM Consumer Sentiment", "Индекс потребительских настроений (предв., Мичиганский университет)"],
    // особые шаблоны
    ["10-y Bond Auction", "Аукцион 10-летних гособлигаций"],
    ["German 30-y Bond Auction", "Аукцион 30-летних гособлигаций (Германия)"],
    ["FOMC Member Barkin Speaks", "Выступление члена FOMC (Barkin)"],
    ["RBA Assist Gov Kent Speaks", "Выступление заместителя главы РБА (Kent)"],
    ["Bank Holiday", "Выходной день, банки закрыты"],
  ];

  it.each(cases)("translates %s", (en, ru) => {
    expect(translateEventTitle(en, "ru")).toBe(ru);
  });

  it("keeps an unknown indicator in English but still handles the frame", () => {
    // Показателя нет в словаре — страна и период всё равно переведены,
    // строка остаётся читаемой, ничего не выдумываем.
    expect(translateEventTitle("German Widget Index m/m", "ru")).toBe(
      "Widget Index (Германия, м/м)",
    );
  });

  it("does not choke on empty or odd input", () => {
    expect(translateEventTitle("", "ru")).toBe("");
    expect(translateEventTitle("   ", "ru")).toBe("   ");
  });

  it("prefers the longer term over its substring", () => {
    // «Core CPI» должен выиграть у «CPI», иначе получится «Core ИПЦ».
    expect(translateEventTitle("Core CPI y/y", "ru")).toBe("Базовый ИПЦ (г/г)");
  });
});

describe("explainEvent", () => {
  it("explains well-known indicators in both languages", () => {
    expect(explainEvent("Core CPI m/m", "ru")).toContain("еды и топлива");
    expect(explainEvent("Core CPI m/m", "en")).toContain("food and fuel");
  });

  it("picks the explanation of the more specific term", () => {
    const core = explainEvent("Core CPI m/m", "ru");
    const plain = explainEvent("CPI m/m", "ru");
    expect(core).not.toBe(plain);
  });

  it("returns null for an indicator without an explanation", () => {
    expect(explainEvent("German WPI m/m", "ru")).toBeNull();
    expect(explainEvent("Some Unknown Release", "ru")).toBeNull();
  });
});
