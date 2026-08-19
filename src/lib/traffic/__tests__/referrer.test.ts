import { describe, it, expect } from "vitest";
import { classifySource, hostOf } from "@/lib/traffic/referrer";

const q = (s: string) => new URLSearchParams(s);

describe("hostOf", () => {
  it("вытаскивает хост без www", () => {
    expect(hostOf("https://www.google.com/search?q=1")).toBe("google.com");
    expect(hostOf("мусор")).toBeNull();
    expect(hostOf(null)).toBeNull();
  });
});

describe("classifySource", () => {
  it("без Referer — прямой заход", () => {
    expect(classifySource(null, q(""), "tradestats.app")).toMatchObject({ source: "direct", refHost: null });
  });

  it("поиск, соцсети и обычные ссылки разводятся по категориям", () => {
    expect(classifySource("https://www.google.com/", q(""), "tradestats.app").source).toBe("search");
    expect(classifySource("https://yandex.ru/search/", q(""), "tradestats.app").source).toBe("search");
    expect(classifySource("https://t.me/somechannel", q(""), "tradestats.app").source).toBe("social");
    expect(classifySource("https://smart-lab.ru/blog/1", q(""), "tradestats.app").source).toBe("referral");
  });

  it("свой же хост — внутренний переход, а не источник", () => {
    expect(classifySource("https://tradestats.app/news", q(""), "tradestats.app").source).toBe("internal");
    expect(classifySource("https://www.tradestats.app/", q(""), "tradestats.app:3000").source).toBe("internal");
  });

  it("utm-метка перебивает Referer: из мессенджера его часто нет вовсе", () => {
    const r = classifySource(null, q("utm_source=telegram&utm_medium=post&utm_campaign=launch"), "tradestats.app");
    expect(r).toMatchObject({ source: "campaign", refHost: "telegram", utmMedium: "post", utmCampaign: "launch" });
  });

  it("короткий ?ref= работает как utm_source", () => {
    expect(classifySource("https://google.com/", q("ref=blogger"), "tradestats.app")).toMatchObject({
      source: "campaign",
      refHost: "blogger",
    });
  });
});
