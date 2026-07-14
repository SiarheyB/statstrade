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
});