import { describe, it, expect, vi } from "vitest";

vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => null }),
}));

import { jsonForScriptTag, siteJsonLd } from "@/lib/seo";

describe("jsonForScriptTag", () => {
  // JSON.stringify не экранирует "<" и ">", а разметка вставляется в страницу
  // через dangerouslySetInnerHTML внутрь <script type="application/ld+json">.
  // Значит любое значение с "</script>" закрывает тег, и дальше начинается
  // исполняемый код. CSP это не ловит: в script-src стоит 'unsafe-inline'.
  it("закрывающий тег внутри значения не разрывает <script>", () => {
    const out = jsonForScriptTag({ url: 'a"}</script><script>alert(1)</script>' });
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
  });

  it("экранирование не ломает разбор JSON", () => {
    const value = { url: "https://x.example/</script>", n: 1, list: [1, 2] };
    expect(JSON.parse(jsonForScriptTag(value))).toEqual(value);
  });

  it("U+2028 и U+2029 экранируются — иначе они рвут JS-строку", () => {
    const out = jsonForScriptTag({ s: "a\u2028b\u2029c" });
    expect(out).not.toContain("\u2028");
    expect(out).not.toContain("\u2029");
    expect(JSON.parse(out).s).toBe("a\u2028b\u2029c");
  });

  it("амперсанд тоже экранируется — на случай вставки в атрибут", () => {
    expect(jsonForScriptTag({ s: "a&b" })).not.toContain("&");
  });
});

describe("siteJsonLd", () => {
  it("не содержит символов, способных выйти за пределы <script>", async () => {
    const out = await siteJsonLd("ru");
    expect(out).not.toContain("<");
    expect(out).not.toContain(">");
    const parsed = JSON.parse(out);
    expect(parsed["@type"]).toBe("WebApplication");
    expect(parsed.inLanguage).toBe("ru-RU");
  });
});
