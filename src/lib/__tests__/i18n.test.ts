/**
 * Тест для модуля i18n.
 */
import { describe, it, expect } from "vitest";
import { dictionaries } from "../i18n/dictionaries";

describe("dictionaries module", () => {
  it("exposes a default locale as an index with correct shape", () => {
    // dictionaries.en и dictionaries.ru являются объектами
    expect(dictionaries.en).toBeTypeOf("object");
    expect(dictionaries.ru).toBeTypeOf("object");
    // Verify there is a key "common.appName" present in the dictionary (as an example)
    expect(dictionaries.en["common.appName"]).toBe("TradeStats");
    expect(dictionaries.ru["common.appName"]).toBe("TradeStats");
  });

  // Паритет ключей. Без него пропущенный перевод виден только на экране —
  // и обычно уже пользователю: интерфейс показывает голый ключ вроде
  // «game.world.style» вместо слова. Так и было найдено несколько пропусков.
  it("в обоих словарях один и тот же набор ключей", () => {
    const en = Object.keys(dictionaries.en);
    const ru = Object.keys(dictionaries.ru);
    const missingInRu = en.filter((key) => !(key in dictionaries.ru));
    const missingInEn = ru.filter((key) => !(key in dictionaries.en));
    expect({ missingInRu, missingInEn }).toEqual({ missingInRu: [], missingInEn: [] });
    expect(en.length).toBe(ru.length);
  });

  it("ни один перевод не пустой", () => {
    for (const locale of ["en", "ru"] as const) {
      const empty = Object.entries(dictionaries[locale])
        .filter(([, value]) => typeof value === "string" && value.trim() === "")
        .map(([key]) => key);
      expect({ locale, empty }).toEqual({ locale, empty: [] });
    }
  });
});