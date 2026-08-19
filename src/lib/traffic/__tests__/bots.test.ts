import { describe, it, expect } from "vitest";
import { detectBot, isScannerPath } from "@/lib/traffic/bots";

const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const browserHeaders = { acceptLanguage: "ru-RU,ru;q=0.9", secFetchMode: "navigate" };

describe("detectBot: явные подписи в User-Agent", () => {
  it("узнаёт поисковых роботов", () => {
    const v = detectBot({ userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" });
    expect(v).toMatchObject({ isBot: true, name: "Googlebot", category: "search" });
  });

  it("узнаёт AI-краулеров и SEO-краулеров", () => {
    expect(detectBot({ userAgent: "GPTBot/1.0" })).toMatchObject({ isBot: true, category: "ai" });
    expect(detectBot({ userAgent: "Mozilla/5.0 (compatible; AhrefsBot/7.0)" })).toMatchObject({ category: "seo" });
  });

  it("превью ссылок в мессенджерах — тоже робот, но своей категории", () => {
    expect(detectBot({ userAgent: "TelegramBot (like TwitterBot)" })).toMatchObject({ isBot: true, category: "social" });
  });

  it("консольные клиенты", () => {
    expect(detectBot({ userAgent: "curl/8.4.0" })).toMatchObject({ isBot: true, name: "curl" });
    expect(detectBot({ userAgent: "python-requests/2.31.0" })).toMatchObject({ isBot: true, category: "tool" });
  });
});

describe("detectBot: эвристики", () => {
  it("живой браузер человеком и остаётся", () => {
    expect(detectBot({ userAgent: CHROME, ...browserHeaders })).toMatchObject({ isBot: false, name: null });
  });

  it("Safari на iPhone — человек", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
    expect(detectBot({ userAgent: ua, ...browserHeaders }).isBot).toBe(false);
  });

  it("пустой User-Agent — робот", () => {
    expect(detectBot({ userAgent: "" })).toMatchObject({ isBot: true, reason: "empty-ua" });
    expect(detectBot({ userAgent: null })).toMatchObject({ isBot: true });
  });

  it("браузерный UA без Accept-Language и Sec-Fetch-* — робот", () => {
    expect(detectBot({ userAgent: CHROME })).toMatchObject({ isBot: true, reason: "no-browser-headers" });
  });

  it("одного отсутствующего заголовка мало: старый браузер не должен выпадать в роботы", () => {
    expect(detectBot({ userAgent: CHROME, acceptLanguage: "en-US" }).isBot).toBe(false);
    expect(detectBot({ userAgent: CHROME, secFetchMode: "navigate" }).isBot).toBe(false);
  });

  it("сканер уязвимостей ловится по пути даже с человеческим UA", () => {
    const v = detectBot({ userAgent: CHROME, ...browserHeaders, path: "/wp-login.php" });
    expect(v).toMatchObject({ isBot: true, category: "scanner", reason: "scanner-path" });
  });
});

describe("isScannerPath", () => {
  it("отличает пути сканеров от нормальных страниц", () => {
    expect(isScannerPath("/.env")).toBe(true);
    expect(isScannerPath("/phpmyadmin/index.php")).toBe(true);
    expect(isScannerPath("/dashboard/trades")).toBe(false);
    expect(isScannerPath("/")).toBe(false);
  });
});
