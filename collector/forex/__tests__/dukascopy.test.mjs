import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchCandles, fetchTicks, DUKAS_INTERVAL } from "../dukascopy.mjs";

// Разбор ответа freeserv — чистая логика, которую стоит держать под тестом:
// формат недокументированный (JSONP от виджета), и его поломка выглядит как
// «золото просто перестало обновляться», а не как явная ошибка.

const okResponse = (body) => ({ ok: true, status: 200, text: async () => body });

describe("collector/forex/dukascopy", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("разбирает JSONP и отдаёт свечи по возрастанию времени", async () => {
    // Dukascopy отдаёт бары от свежего к старому — порядок нужно перевернуть.
    fetch.mockResolvedValue(okResponse("cb([[2000,2,3,1,2.5,0.2],[1000,1,2,0.5,1.5,0.1]]);"));

    const candles = await fetchCandles("XAU/USD", "1m", 2);

    expect(candles).toEqual([
      { t: 1000, o: 1, h: 2, l: 0.5, c: 1.5, v: 0.1 },
      { t: 2000, o: 2, h: 3, l: 1, c: 2.5, v: 0.2 },
    ]);
  });

  it("шлёт User-Agent и Referer", async () => {
    // Без этих заголовков сервис отвечает 200 с пустым телом — самая
    // неочевидная причина «данных нет», поэтому она закреплена тестом.
    fetch.mockResolvedValue(okResponse("cb([]);"));

    await fetchCandles("XAU/USD", "1m", 1);

    const [, init] = fetch.mock.calls[0];
    expect(init.headers["User-Agent"]).toMatch(/Mozilla/);
    expect(init.headers.Referer).toBe("https://freeserv.dukascopy.com/");
  });

  it("подставляет интервал Dukascopy и границу окна в запрос", async () => {
    fetch.mockResolvedValue(okResponse("cb([]);"));

    await fetchCandles("XAU/USD", "1h", 8, 1700000000000);

    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.searchParams.get("instrument")).toBe("XAU/USD");
    expect(url.searchParams.get("interval")).toBe("1HOUR");
    expect(url.searchParams.get("limit")).toBe("8");
    expect(url.searchParams.get("timestamp")).toBe("1700000000000");
    expect(url.searchParams.get("time_direction")).toBe("P");
  });

  it("отбрасывает мусорные строки вместо падения", async () => {
    fetch.mockResolvedValue(okResponse("cb([null,[1000,1,2,0.5,1.5]]);"));

    const candles = await fetchCandles("XAU/USD", "1m", 2);

    expect(candles).toEqual([{ t: 1000, o: 1, h: 2, l: 0.5, c: 1.5, v: 0 }]);
  });

  it("возвращает пустой массив, когда данных нет (cb([null]))", async () => {
    fetch.mockResolvedValue(okResponse("cb([null]);"));

    await expect(fetchCandles("XAU/USD", "1m", 1)).resolves.toEqual([]);
  });

  it("повторяет запрос после 503 и отдаёт данные со второй попытки", async () => {
    fetch
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => "" })
      .mockResolvedValue(okResponse("cb([[1000,1,2,0.5,1.5,0.1]]);"));

    const candles = await fetchCandles("XAU/USD", "1m", 1);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(candles).toHaveLength(1);
  });

  it("объясняет пустой ответ подсказкой про заголовки", async () => {
    fetch.mockResolvedValue(okResponse("   "));

    await expect(fetchCandles("XAU/USD", "1m", 1)).rejects.toThrow(/User-Agent/);
  });

  it("не даёт запросить 4h — он собирается агрегацией из 1h", async () => {
    // У Dukascopy 4h выровнен по UTC-полуночи, у нас — со сдвигом на час.
    expect(DUKAS_INTERVAL["4h"]).toBeUndefined();
    await expect(fetchCandles("XAU/USD", "4h", 3)).rejects.toThrow(/не поддерживается/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("разбирает тики как bid/ask с объёмами", async () => {
    fetch.mockResolvedValue(okResponse("cb([[1500,4607.4,4608.6,120,90]]);"));

    const ticks = await fetchTicks("XAU/USD", 1);

    expect(ticks).toEqual([{ t: 1500, bid: 4607.4, ask: 4608.6, bidVol: 120, askVol: 90 }]);
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get("interval")).toBe("TICK");
  });
});
