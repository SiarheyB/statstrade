import { describe, it, expect } from "vitest";
import { csvFileName, toCsv } from "@/lib/traffic/csv";

describe("toCsv", () => {
  it("собирает файл с заголовком и BOM для Excel", () => {
    const out = toCsv(["Дата", "Визиты"], [["2026-08-19", 12]]);
    expect(out.startsWith("﻿")).toBe(true);
    expect(out).toContain("Дата;Визиты\r\n2026-08-19;12");
  });

  it("экранирует разделитель, кавычки и переносы строк", () => {
    const out = toCsv(["a"], [['точка; с запятой'], ['он сказал "да"'], ["две\nстроки"]]);
    expect(out).toContain('"точка; с запятой"');
    expect(out).toContain('"он сказал ""да"""');
    expect(out).toContain('"две\nстроки"');
  });

  it("пустые значения не ломают строку", () => {
    expect(toCsv(["a", "b"], [[null, undefined]])).toContain(";");
  });
});

describe("csvFileName", () => {
  it("имя файла говорит, что внутри и за какой период", () => {
    expect(csvFileName("pages", "30d", new Date("2026-08-19T10:00:00Z"))).toBe("traffic-pages-30d-2026-08-19.csv");
  });
});
