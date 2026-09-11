import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseInvestingRows } from "@/lib/econcalInvesting";

// Разметка в фикстуре снята с ЖИВОГО ответа ru.investing.com (три строки
// разной важности, с фактом/прогнозом/предыдущим). Разбор чужого HTML ломается
// не от наших правок, а от правок на их стороне, и поймать это можно только
// на настоящей разметке — синтетический образец подтвердил бы лишь то, что мы
// умеем читать собственную выдумку.
const FIXTURE = fs.readFileSync(
  path.join(__dirname, "fixtures", "investing-rows.html"),
  "utf8",
);

describe("парсер календаря investing", () => {
  const rows = parseInvestingRows(FIXTURE);

  it("читает все строки событий", () => {
    expect(rows).toHaveLength(3);
  });

  it("переводит звёзды в важность: 3 — high, 2 — medium, 1 — low", () => {
    expect(rows.map((r) => r.impact)).toEqual(["high", "medium", "low"]);
  });

  it("разбирает время как UTC, а не в поясе сервера", () => {
    // Запрос к investing идёт с timeZone=55 (UTC), а в разметке время указано
    // БЕЗ смещения: разбери мы его через new Date(строка), весь календарь
    // уехал бы на часовой пояс машины — правдоподобно и потому незаметно.
    expect(rows[0].time.toISOString()).toBe("2026-09-07T23:50:00.000Z");
  });

  it("берёт валюту и русское название события", () => {
    expect(rows[0].currency).toBe("JPY");
    expect(rows[0].title).toContain("ВВП");
  });

  it("вытаскивает факт, прогноз и предыдущее значение", () => {
    expect(rows[0]).toMatchObject({ actual: "0,4%", forecast: "0,3%", previous: "0,5%" });
  });

  it("не падает на пустой или чужой разметке", () => {
    expect(parseInvestingRows("")).toEqual([]);
    expect(parseInvestingRows("<table><tr><td>ничего похожего</td></tr></table>")).toEqual([]);
  });
});
