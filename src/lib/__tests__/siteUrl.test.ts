import { describe, it, expect, vi, beforeEach } from "vitest";

const headerStore = new Map<string, string>();
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (k: string) => headerStore.get(k.toLowerCase()) ?? null }),
}));

import { siteUrl } from "@/lib/siteUrl";

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
});
