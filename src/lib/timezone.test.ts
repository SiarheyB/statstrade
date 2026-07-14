import {
  isTimezone,
  normalizeTimezone,
  getTimezoneFromCookie,
  offsetMinutes,
  ianaFor,
  shiftedMs,
  zonedParts,
  zonedDateToUtcMs,
  TIMEZONE_COOKIE,
  TIMEZONES,
} from "./timezone";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("normalizeTimezone", () => {
  it("возвращает 'auto' для пустых/невалидных значений", () => {
    expect(normalizeTimezone(null)).toBe("auto");
    expect(normalizeTimezone(undefined)).toBe("auto");
    expect(normalizeTimezone("")).toBe("auto");
    expect(normalizeTimezone("   ")).toBe("auto");
  });

  it("пропускает уже валидные id как есть", () => {
    expect(normalizeTimezone("auto")).toBe("auto");
    expect(normalizeTimezone("UTC")).toBe("UTC");
    expect(normalizeTimezone("UTC+3")).toBe("UTC+3");
    expect(normalizeTimezone("UTC-12")).toBe("UTC-12");
    expect(normalizeTimezone("UTC+14")).toBe("UTC+14");
  });

  it("нормализует неканонические, но валидные форматы", () => {
    expect(normalizeTimezone("utc+3")).toBe("UTC+3"); // нижний регистр
    expect(normalizeTimezone("UTC+03")).toBe("UTC+3"); // ведущий ноль
    expect(normalizeTimezone("utc-5")).toBe("UTC-5");
    expect(normalizeTimezone("+3")).toBe("UTC+3"); // без префикса UTC
    expect(normalizeTimezone("-5")).toBe("UTC-5");
    expect(normalizeTimezone(" UTC+2 ")).toBe("UTC+2"); // пробелы по краям
  });

  it("отвергает значения вне диапазона ±12..+14", () => {
    expect(normalizeTimezone("UTC+15")).toBe("auto");
    expect(normalizeTimezone("UTC-13")).toBe("auto");
    expect(normalizeTimezone("+20")).toBe("auto");
    expect(normalizeTimezone("UTC+99")).toBe("auto");
  });

  it("отвергает произвольный мусор", () => {
    expect(normalizeTimezone("Moscow")).toBe("auto");
    expect(normalizeTimezone("UTC+3:30")).toBe("auto");
    expect(normalizeTimezone("Europe/Paris")).toBe("auto");
    expect(normalizeTimezone("UTC+X")).toBe("auto");
  });

  it("все элементы TIMEZONES после нормализации неизменны", () => {
    for (const { id } of TIMEZONES) {
      expect(normalizeTimezone(id)).toBe(id);
    }
  });
});

describe("isTimezone", () => {
  it("true для валидных id", () => {
    expect(isTimezone("auto")).toBe(true);
    expect(isTimezone("UTC")).toBe(true);
    expect(isTimezone("UTC+3")).toBe(true);
    expect(isTimezone("UTC-12")).toBe(true);
  });

  it("false для невалидных", () => {
    expect(isTimezone(null)).toBe(false);
    expect(isTimezone(undefined)).toBe(false);
    expect(isTimezone("")).toBe(false);
    expect(isTimezone("UTC+99")).toBe(false);
    expect(isTimezone("garbage")).toBe(false);
  });
});

describe("offsetMinutes", () => {
  it("корректно переводит в минуты", () => {
    expect(offsetMinutes("auto")).toBeNull();
    expect(offsetMinutes("UTC")).toBe(0);
    expect(offsetMinutes("UTC+3")).toBe(180);
    expect(offsetMinutes("UTC-5")).toBe(-300);
  });
});

describe("ianaFor", () => {
  it("конвертирует в Etc/GMT с инверсией знака", () => {
    expect(ianaFor("UTC")).toBe("UTC");
    expect(ianaFor("UTC+3")).toBe("Etc/GMT-3");
    expect(ianaFor("UTC-5")).toBe("Etc/GMT+5");
    expect(ianaFor("auto")).toBeUndefined();
  });
});

describe("shiftedMs / zonedParts (сдвиг времени)", () => {
  it("UTC не сдвигается", () => {
    const ms = Date.UTC(2023, 0, 1, 12, 30, 0);
    expect(shiftedMs(ms, "UTC").ms).toBe(ms);
    expect(shiftedMs(ms, "UTC").useUtc).toBe(true);
    const p = zonedParts(ms, "UTC");
    expect(p.y).toBe(2023);
    expect(p.mo).toBe(0);
    expect(p.d).toBe(1);
    expect(p.h).toBe(12);
    expect(p.mi).toBe(30);
  });

  it("UTC+3 сдвигает на +3 часа", () => {
    const ms = Date.UTC(2023, 0, 1, 9, 0, 0);
    const { ms: shifted, useUtc } = shiftedMs(ms, "UTC+3");
    expect(useUtc).toBe(true);
    expect(shifted).toBe(ms + 3 * 60 * 60 * 1000);
    const p = zonedParts(ms, "UTC+3");
    expect(p.h).toBe(12); // 09:00 UTC -> 12:00 UTC+3
    expect(p.d).toBe(1);
  });

  it("UTC-5 сдвигает на -5 часов (с переходом суток)", () => {
    const ms = Date.UTC(2023, 0, 1, 3, 0, 0);
    const p = zonedParts(ms, "UTC-5");
    expect(p.h).toBe(22); // 03:00 UTC пред. суток -> 22:00 UTC-5
    expect(p.d).toBe(31); // 31 декабря пред. года
    expect(p.mo).toBe(11);
  });

  it("auto использует локальное время устройства", () => {
    const ms = Date.UTC(2023, 5, 15, 10, 0, 0);
    const { useUtc } = shiftedMs(ms, "auto");
    expect(useUtc).toBe(false);
    const p = zonedParts(ms, "auto");
    const local = new Date(ms);
    expect(p.h).toBe(local.getHours());
    expect(p.d).toBe(local.getDate());
  });
});

describe("zonedDateToUtcMs (обратная операция)", () => {
  it("UTC+3: полночь в поясе = 21:00 UTC пред. дня", () => {
    const ms = zonedDateToUtcMs(2023, 0, 1, "UTC+3");
    expect(new Date(ms).getUTCHours()).toBe(21);
    expect(new Date(ms).getUTCDate()).toBe(31);
    expect(new Date(ms).getUTCMonth()).toBe(11);
    expect(new Date(ms).getUTCFullYear()).toBe(2022);
  });

  it("UTC-5: полночь в поясе = 05:00 UTC того же дня", () => {
    const ms = zonedDateToUtcMs(2023, 0, 1, "UTC-5");
    expect(new Date(ms).getUTCHours()).toBe(5);
    expect(new Date(ms).getUTCDate()).toBe(1);
    expect(new Date(ms).getUTCMonth()).toBe(0);
  });

  it("auto: обычный new Date(y,mo,d)", () => {
    const ms = zonedDateToUtcMs(2023, 0, 1, "auto");
    expect(new Date(ms).getFullYear()).toBe(2023);
    expect(new Date(ms).getMonth()).toBe(0);
    expect(new Date(ms).getDate()).toBe(1);
  });
});

describe("getTimezoneFromCookie (browser-only)", () => {
  const ORIGINAL_DOC = (globalThis as any).document;

  afterEach(() => {
    (globalThis as any).document = ORIGINAL_DOC;
  });

  it("возвращает 'auto', если document undefined (SSR)", () => {
    (globalThis as any).document = undefined;
    expect(getTimezoneFromCookie()).toBe("auto");
  });

  it("читает и нормализует валидную куки", () => {
    (globalThis as any).document = {
      cookie: `foo=bar; ${TIMEZONE_COOKIE}=UTC+3; lang=ru`,
    };
    expect(getTimezoneFromCookie()).toBe("UTC+3");
  });

  it("нормализует неканоническую куки", () => {
    (globalThis as any).document = {
      cookie: `${TIMEZONE_COOKIE}=utc-5`,
    };
    expect(getTimezoneFromCookie()).toBe("UTC-5");
  });

  it("фоллбэк на 'auto' при невалидной куки", () => {
    (globalThis as any).document = {
      cookie: `${TIMEZONE_COOKIE}=garbage`,
    };
    expect(getTimezoneFromCookie()).toBe("auto");
  });

  it("фоллбэк на 'auto' при отсутствии куки", () => {
    (globalThis as any).document = { cookie: "foo=bar" };
    expect(getTimezoneFromCookie()).toBe("auto");
  });
});
