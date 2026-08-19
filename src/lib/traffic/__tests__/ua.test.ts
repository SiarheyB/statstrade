import { describe, it, expect } from "vitest";
import { parseUa, primaryLang } from "@/lib/traffic/ua";

describe("parseUa", () => {
  it("десктопный Chrome", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
    expect(parseUa(ua)).toEqual({ device: "desktop", browser: "Chrome", os: "Windows 10/11" });
  });

  it("телефон и планшет различаются", () => {
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1";
    const ipad = "Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Safari/604.1";
    expect(parseUa(iphone).device).toBe("mobile");
    expect(parseUa(ipad).device).toBe("tablet");
  });

  it("Edge и Yandex не путаются с Chrome (их UA содержит слово Chrome)", () => {
    expect(parseUa("Mozilla/5.0 (Windows NT 10.0) Chrome/124.0 Safari/537.36 Edg/124.0").browser).toBe("Edge");
    expect(parseUa("Mozilla/5.0 (Windows NT 10.0) Chrome/124.0 YaBrowser/24.4 Safari/537.36").browser).toBe("Yandex Browser");
  });

  it("у робота устройство помечается отдельно", () => {
    expect(parseUa("Googlebot/2.1", true)).toMatchObject({ device: "bot", browser: null });
  });

  it("пустой UA", () => {
    expect(parseUa(null)).toEqual({ device: "unknown", browser: null, os: null });
  });
});

describe("primaryLang", () => {
  it("берёт основной язык", () => {
    expect(primaryLang("ru-RU,ru;q=0.9,en-US;q=0.8")).toBe("ru");
    expect(primaryLang("en")).toBe("en");
    expect(primaryLang(null)).toBeNull();
    expect(primaryLang("*")).toBeNull();
  });
});
