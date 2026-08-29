import { describe, it, expect } from "vitest";
import { buildHit, shortHash, clientIpFromHeaders, countryFromHeaders } from "@/lib/traffic/hit";

const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function headers(extra: Record<string, string> = {}) {
  return new Headers({
    "user-agent": CHROME,
    "accept-language": "ru-RU,ru;q=0.9",
    "sec-fetch-mode": "navigate",
    host: "tradestats.app",
    ...extra,
  });
}

const NOW = new Date("2026-08-19T10:00:00Z");

describe("clientIpFromHeaders", () => {
  // Из IP считается visitorId, а по нему работает защита от заливки таблицы
  // просмотров (floodCheck в ingest.ts). Подделываемый адрес = новый
  // «посетитель» на каждый запрос и обход этой защиты. Общая реализация с
  // лимитами — см. lib/ratelimit.ts.
  it("доверяет только тому, что проставил наш прокси", () => {
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "3.3.3.3" }))).toBe("3.3.3.3");
    // последний элемент цепочки — ближайший к нам; всё левее мог написать клиент
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "2.2.2.2, 10.0.0.1" }))).toBe("10.0.0.1");
    expect(clientIpFromHeaders(new Headers())).toBe("unknown");
  });

  it("не даёт подменить адрес заголовком cf-connecting-ip", () => {
    expect(
      clientIpFromHeaders(new Headers({ "cf-connecting-ip": "1.1.1.1", "x-real-ip": "3.3.3.3" })),
    ).toBe("3.3.3.3");
  });
});

describe("countryFromHeaders", () => {
  it("берёт страну из заголовка CDN", () => {
    expect(countryFromHeaders(new Headers({ "cf-ipcountry": "de" }))).toBe("DE");
    expect(countryFromHeaders(new Headers({ "x-vercel-ip-country": "BY" }))).toBe("BY");
  });

  it("заглушки CDN («страна неизвестна», Tor, анонимайзер) за страну не считаются", () => {
    expect(countryFromHeaders(new Headers({ "cf-ipcountry": "XX" }))).toBeNull();
    expect(countryFromHeaders(new Headers({ "cf-ipcountry": "T1" }))).toBeNull();
    expect(countryFromHeaders(new Headers({ "cf-ipcountry": "RUS" }))).toBeNull(); // не двухбуквенный код
  });

  it("без CDN страны нет — и это нормально, колонка просто пустая", () => {
    expect(countryFromHeaders(new Headers())).toBeNull();
  });
});

describe("shortHash", () => {
  it("детерминирован и не содержит исходной строки", async () => {
    const a = await shortHash("1.2.3.4");
    expect(a).toBe(await shortHash("1.2.3.4"));
    expect(a).not.toContain("1.2.3.4");
    expect(a).toHaveLength(16);
    expect(a).not.toBe(await shortHash("1.2.3.5"));
  });
});

describe("buildHit", () => {
  it("собирает событие для человека, пришедшего из поиска", async () => {
    const { hit } = await buildHit({
      url: new URL("https://tradestats.app/news"),
      headers: headers({ referer: "https://www.google.com/" }),
      now: NOW,
    });
    expect(hit).toMatchObject({
      path: "/news",
      isBot: false,
      source: "search",
      refHost: "google.com",
      device: "desktop",
      browser: "Chrome",
      lang: "ru",
      nav: "load",
      authed: false,
    });
  });

  it("робота помечает и не пытается вычислить ему браузер", async () => {
    const { hit } = await buildHit({
      url: new URL("https://tradestats.app/"),
      headers: new Headers({ "user-agent": "Mozilla/5.0 (compatible; Googlebot/2.1)", host: "tradestats.app" }),
      now: NOW,
    });
    expect(hit).toMatchObject({ isBot: true, botName: "Googlebot", botCategory: "search", device: "bot" });
  });

  it("без cookie идентификаторы детерминированы: робот не размножается в тысячу посетителей", async () => {
    const args = { url: new URL("https://tradestats.app/"), headers: headers({ "x-forwarded-for": "5.5.5.5" }), now: NOW };
    const a = await buildHit(args);
    const b = await buildHit({ ...args, url: new URL("https://tradestats.app/news") });
    expect(a.visitorId).toBe(b.visitorId);
    expect(a.sessionId).toBe(b.sessionId);
  });

  it("cookie важнее вычисленного идентификатора", async () => {
    const { visitorId, sessionId } = await buildHit({
      url: new URL("https://tradestats.app/"),
      headers: headers(),
      visitorCookie: "vid-1",
      sessionCookie: "sid-1",
      now: NOW,
    });
    expect(visitorId).toBe("vid-1");
    expect(sessionId).toBe("sid-1");
  });

  it("разные посетители получают разные идентификаторы", async () => {
    const a = await buildHit({ url: new URL("https://tradestats.app/"), headers: headers({ "x-forwarded-for": "5.5.5.5" }), now: NOW });
    const b = await buildHit({ url: new URL("https://tradestats.app/"), headers: headers({ "x-forwarded-for": "6.6.6.6" }), now: NOW });
    expect(a.visitorId).not.toBe(b.visitorId);
  });

  it("бескуковый режим: присланные cookie игнорируются, идентификатор считается сам", async () => {
    process.env.ANALYTICS_COOKIES = "false";
    const { visitorId, sessionId } = await buildHit({
      url: new URL("https://tradestats.app/"),
      headers: headers(),
      visitorCookie: "vid-1",
      sessionCookie: "sid-1",
      now: NOW,
    });
    expect(visitorId).not.toBe("vid-1");
    expect(visitorId.startsWith("h")).toBe(true);
    expect(sessionId.startsWith("s")).toBe(true);
    delete process.env.ANALYTICS_COOKIES;
  });

  it("токен публичной ссылки в событие не попадает", async () => {
    const { hit } = await buildHit({
      url: new URL("https://tradestats.app/share/secret-token-value"),
      headers: headers(),
      now: NOW,
    });
    expect(hit.path).toBe("/share/[token]");
  });

  it("авторизованный запрос помечается пользователем", async () => {
    const { hit } = await buildHit({
      url: new URL("https://tradestats.app/dashboard"),
      headers: headers(),
      authed: true,
      userId: "u1",
      nav: "spa",
      now: NOW,
    });
    expect(hit).toMatchObject({ authed: true, userId: "u1", nav: "spa" });
  });
});
