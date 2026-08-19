import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { pageViewKind, resetIngestUrlCache, sendHit } from "@/lib/traffic/track";

function req(url: string, headers: Record<string, string> = {}, method = "GET") {
  return new NextRequest(new Request(`https://tradestats.app${url}`, { method, headers }));
}

// Так выглядит настоящий переход по адресу в браузере.
const DOC = {
  accept: "text/html,application/xhtml+xml",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
};
// А так — служебный запрос роутера (предзагрузка ссылки, подтяжка сегмента).
const RSC_FETCH = { accept: "*/*", "sec-fetch-dest": "empty", "sec-fetch-mode": "cors" };

describe("pageViewKind", () => {
  it("обычная загрузка страницы", () => {
    expect(pageViewKind(req("/", DOC))).toBe("load");
    expect(pageViewKind(req("/news", DOC))).toBe("load");
  });

  it("робот без Sec-Fetch-* считается по Accept — ради него всё и затевалось", () => {
    expect(pageViewKind(req("/", { accept: "*/*" }))).toBe("load");
    expect(pageViewKind(req("/", { accept: "text/html" }))).toBe("load");
  });

  it("служебный запрос роутера просмотром НЕ считается (в Next 16 заголовка RSC в middleware уже нет)", () => {
    expect(pageViewKind(req("/news", RSC_FETCH))).toBeNull();
    expect(pageViewKind(req("/dashboard/trades", RSC_FETCH))).toBeNull();
  });

  it("предзагрузка ссылки просмотром НЕ считается", () => {
    expect(pageViewKind(req("/news", { ...RSC_FETCH, "next-router-prefetch": "1" }))).toBeNull();
    expect(pageViewKind(req("/news", { ...DOC, purpose: "prefetch" }))).toBeNull();
  });

  it("API, статика и не-GET отбрасываются", () => {
    expect(pageViewKind(req("/api/stats", DOC))).toBeNull();
    expect(pageViewKind(req("/_next/static/x.js", DOC))).toBeNull();
    expect(pageViewKind(req("/logo.svg", DOC))).toBeNull();
    expect(pageViewKind(req("/", DOC, "POST"))).toBeNull();
  });

  it("запрос картинки или json со страницы не путается с просмотром", () => {
    expect(pageViewKind(req("/news", { accept: "image/avif,image/webp" }))).toBeNull();
    expect(pageViewKind(req("/news", { accept: "application/json" }))).toBeNull();
    expect(pageViewKind(req("/news", { accept: "*/*", "sec-fetch-dest": "image" }))).toBeNull();
  });
});

describe("sendHit: адрес приёмника", () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    resetIngestUrlCache();
    delete process.env.ANALYTICS_INGEST_URL;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("шлёт событие на петлю, а не наружу", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    global.fetch = fetchMock as unknown as typeof fetch;
    await sendHit("{}", "key");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:3000/api/analytics/collect");
    expect(fetchMock.mock.calls[0][1].headers["x-analytics-key"]).toBe("key");
  });

  it("если по имени не достучались — пробует IPv4-адрес (иначе статистика молча теряется)", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValue(new Response("{}"));
    global.fetch = fetchMock as unknown as typeof fetch;
    await sendHit("{}", "key");
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      "http://localhost:3000/api/analytics/collect",
      "http://127.0.0.1:3000/api/analytics/collect",
    ]);
  });

  it("рабочий адрес запоминается — перебор не повторяется на каждом просмотре", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValue(new Response("{}"));
    global.fetch = fetchMock as unknown as typeof fetch;
    await sendHit("{}", "key");
    fetchMock.mockClear();
    await sendHit("{}", "key");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:3000/api/analytics/collect");
  });

  it("заданный явно ANALYTICS_INGEST_URL используется как есть", async () => {
    process.env.ANALYTICS_INGEST_URL = "http://app:3000/";
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    global.fetch = fetchMock as unknown as typeof fetch;
    await sendHit("{}", "key");
    expect(fetchMock.mock.calls[0][0]).toBe("http://app:3000/api/analytics/collect");
    delete process.env.ANALYTICS_INGEST_URL;
  });

  it("недоступный приёмник не роняет запрос пользователя", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("down")) as unknown as typeof fetch;
    await expect(sendHit("{}", "key")).resolves.toBeUndefined();
  });
});
