import { describe, it, expect } from "vitest";
import {
  isLocale,
  translate,
  LOCALES,
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
} from "../../i18n/core";
import type { Locale } from "../../i18n/core";

describe("i18n core exports and basic functions", () => {
  it("exports DEFAULT_LOCALE", () => {
    expect(DEFAULT_LOCALE).toBe("en");
  });

  it("exports LOCALE_COOKIE", () => {
    expect(LOCALE_COOKIE).toBe("ts_locale");
  });

  it("exports LOCALES array", () => {
    expect(LOCALES).toEqual([
      { id: "en", label: "English", short: "EN" },
      { id: "ru", label: "Русский", short: "RU" },
    ]);
  });

  it("isLocale returns true for valid locales", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("ru")).toBe(true);
  });

  it("isLocale returns false for invalid locales", () => {
    expect(isLocale("fr")).toBe(false);
    expect(isLocale("de")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(isLocale(null)).toBe(false);
    expect(isLocale("")).toBe(false);
  });

  describe("translate", () => {
    it("translates a known key in English", () => {
      expect(translate("en", "common.appName")).toBe("TradeStats");
      expect(translate("en", "nav.overview")).toBe("Overview");
    });

    it("translates a known key in Russian", () => {
      expect(translate("ru", "nav.overview")).toBe("Обзор");
      expect(translate("ru", "nav.trades")).toBe("Сделки");
    });

    it("translates key with placeholders", () => {
      expect(translate("en", "news.page", { p: 1, total: 5 })).toBe(
        "Page 1 of 5",
      );
      expect(translate("ru", "news.page", { p: 2, total: 4 })).toBe(
        "Стр. 2 из 4",
      );
    });

    it("falls back to key itself when translation is missing", () => {
      expect(translate("ru", "nonexistent.key")).toBe("nonexistent.key");
    });

    it("falls back to RU table when requested locale lacks the key", () => {
      // key present only in RU dict (ru-only keys), returns RU value
      expect(translate("en", "nav.donate")).toBe("Donate");
    });
  });
});
