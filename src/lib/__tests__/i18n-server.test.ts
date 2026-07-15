import { describe, it, expect, vi, beforeEach } from "vitest";

const cookieMap = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ get: (k: string) => (cookieMap.has(k) ? { value: cookieMap.get(k) } : undefined) }),
}));

import { getLocale, getTimezone, getServerT } from "@/lib/i18n/server";

describe("i18n server helpers", () => {
  beforeEach(() => {
    cookieMap.clear();
  });

  it("getLocale falls back to the default when no cookie", async () => {
    expect(await getLocale()).toBe("en");
  });

  it("getLocale reads the locale cookie", async () => {
    cookieMap.set("ts_locale", "ru");
    expect(await getLocale()).toBe("ru");
  });

  it("getLocale ignores an invalid locale", async () => {
    cookieMap.set("ts_locale", "fr");
    expect(await getLocale()).toBe("en");
  });

  it("getTimezone normalizes the cookie value and defaults to auto", async () => {
    expect(await getTimezone()).toBe("auto");
    cookieMap.set("ts_timezone", "UTC+3");
    expect(await getTimezone()).toBe("UTC+3");
  });

  it("getServerT returns a translator bound to the cookie locale", async () => {
    cookieMap.set("ts_locale", "ru");
    const { locale, t } = await getServerT();
    expect(locale).toBe("ru");
    expect(t("nav.overview")).toBe("Обзор");
  });
});
