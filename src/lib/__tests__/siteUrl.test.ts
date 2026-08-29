import { describe, it, expect, vi, beforeEach } from "vitest";

const headerStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (k: string) => headerStore.get(k.toLowerCase()) ?? null }),
}));

import { siteUrl, isHostname } from "@/lib/siteUrl";

function setHeaders(h: Record<string, string>) {
  headerStore.clear();
  for (const [k, v] of Object.entries(h)) headerStore.set(k.toLowerCase(), v);
}

describe("siteUrl", () => {
  beforeEach(() => {
    delete process.env.SITE_URL;
    headerStore.clear();
  });

  it("prefers SITE_URL and trims the trailing slash", async () => {
    process.env.SITE_URL = "https://tradingstat.ru/";
    setHeaders({ host: "whatever.example" });
    expect(await siteUrl()).toBe("https://tradingstat.ru");
  });

  // Cloudflare в режиме Flexible ходит к origin по HTTP и шлёт
  // x-forwarded-proto: http. Доверять этому нельзя — иначе robots.txt и
  // sitemap.xml отдают http-ссылки, каждая из которых ведёт на редирект.
  it("always uses https for a public host, whatever the proxy claims", async () => {
    setHeaders({ "x-forwarded-host": "tradingstat.ru", "x-forwarded-proto": "http" });
    expect(await siteUrl()).toBe("https://tradingstat.ru");
  });

  it("keeps http for local development", async () => {
    setHeaders({ host: "localhost:3000" });
    expect(await siteUrl()).toBe("http://localhost:3000");
    setHeaders({ host: "127.0.0.1:3000" });
    expect(await siteUrl()).toBe("http://127.0.0.1:3000");
  });

  it("falls back to localhost when no host header is present", async () => {
    expect(await siteUrl()).toBe("http://localhost:3000");
  });

  // Заголовок приходит от клиента: nginx отдаёт Host как есть и не трогает
  // x-forwarded-host. Отсюда значение попадает в robots.txt, sitemap.xml и в
  // JSON-LD на каждой странице, а JSON.stringify не экранирует "<".
  it("не пускает в адрес мусор из заголовка — откатывается на дефолт", async () => {
    setHeaders({ "x-forwarded-host": 'a"}</script><script>alert(1)</script>' });
    expect(await siteUrl()).toBe("http://localhost:3000");

    setHeaders({ host: "evil.com/path" });
    expect(await siteUrl()).toBe("http://localhost:3000");

    setHeaders({ host: "with space.example" });
    expect(await siteUrl()).toBe("http://localhost:3000");
  });

  it("нормальные хосты по-прежнему проходят", async () => {
    setHeaders({ host: "tradingstat.ru" });
    expect(await siteUrl()).toBe("https://tradingstat.ru");
    setHeaders({ host: "sub.domain-with-dash.example:8443" });
    expect(await siteUrl()).toBe("https://sub.domain-with-dash.example:8443");
  });
});

describe("isHostname", () => {
  it("пропускает имя хоста с портом и без", () => {
    expect(isHostname("tradingstat.ru")).toBe(true);
    expect(isHostname("localhost:3000")).toBe(true);
    expect(isHostname("127.0.0.1:3000")).toBe(true);
    expect(isHostname("a-b.c-d.example")).toBe(true);
  });

  it("отвергает всё, чем можно выйти за пределы значения", () => {
    for (const bad of [
      "", " ", "evil.com/path", "a\"b", "a<b", "a>b", "a b",
      "-leading.dash", "trailing.dash-", "host:99999999",
      "a\n b", "javascript:alert(1)", "x".repeat(254),
    ]) {
      expect(isHostname(bad), bad).toBe(false);
    }
  });
});
