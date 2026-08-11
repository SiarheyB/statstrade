import { describe, it, expect } from "vitest";
import { dictionaries } from "../../i18n/dictionaries";

// Ключ, который есть только в одном словаре, на другом языке выводится сырым
// (translate возвращает сам ключ). Ловим такие расхождения тестом, а не
// глазами на странице.
describe("i18n dictionaries parity", () => {
  const en = Object.keys(dictionaries.en);
  const ru = Object.keys(dictionaries.ru);

  it("every English key has a Russian translation", () => {
    expect(en.filter((k) => !ru.includes(k))).toEqual([]);
  });

  it("every Russian key has an English translation", () => {
    expect(ru.filter((k) => !en.includes(k))).toEqual([]);
  });

  it("no key is left empty", () => {
    for (const [locale, dict] of Object.entries(dictionaries)) {
      const empty = Object.entries(dict)
        .filter(([, v]) => !String(v).trim())
        .map(([k]) => k);
      expect(empty, `empty values in ${locale}`).toEqual([]);
    }
  });
});
