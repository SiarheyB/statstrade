import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import robots from "../robots";
import sitemap from "../sitemap";

const headerBag = { current: new Map<string, string>() };

vi.mock("next/headers", () => ({
  headers: async () => ({ get: (k: string) => headerBag.current.get(k) ?? null }),
}));

vi.mock("@/lib/db", () => ({ prisma: { newsItem: { findFirst: vi.fn() } } }));

function setHeaders(h: Record<string, string>) {
  headerBag.current = new Map(Object.entries(h));
}

describe("robots.txt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SITE_URL;
    setHeaders({ "x-forwarded-host": "tradestats.app", "x-forwarded-proto": "https" });
  });

  it("закрывает приватные разделы и публичные ссылки на статистику", async () => {
    const r = await robots();
    const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rule.allow).toBe("/");
    // /share/<токен> — сам токен является ключом доступа, в индексе ему не место.
    expect(rule.disallow).toContain("/share/");
    expect(rule.disallow).toContain("/dashboard/");
    expect(rule.disallow).toContain("/admin/");
    expect(rule.disallow).toContain("/api/");
  });

  it("адрес карты сайта берётся из заголовков прокси", async () => {
    expect((await robots()).sitemap).toBe("https://tradestats.app/sitemap.xml");
  });

  it("SITE_URL важнее заголовков — для канонического домена", async () => {
    process.env.SITE_URL = "https://example.com/";
    expect((await robots()).sitemap).toBe("https://example.com/sitemap.xml");
    delete process.env.SITE_URL;
  });
});

describe("sitemap.xml", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SITE_URL;
    setHeaders({ host: "tradestats.app", "x-forwarded-proto": "https" });
  });

  it("перечисляет только публичные страницы", async () => {
    (prisma.newsItem.findFirst as any).mockResolvedValue({ publishedAt: new Date("2026-08-18T10:00:00Z") });
    const urls = (await sitemap()).map((u) => u.url);
    expect(urls).toEqual([
      "https://tradestats.app/",
      "https://tradestats.app/news",
      "https://tradestats.app/calendar",
    ]);
  });

  it("дата обновления ленты — из последней новости, а не «сейчас»", async () => {
    const publishedAt = new Date("2026-08-18T10:00:00Z");
    (prisma.newsItem.findFirst as any).mockResolvedValue({ publishedAt });
    const news = (await sitemap()).find((u) => u.url.endsWith("/news"));
    expect(news?.lastModified).toEqual(publishedAt);
  });

  it("упавшая БД не превращает карту сайта в 500 для робота", async () => {
    (prisma.newsItem.findFirst as any).mockRejectedValue(new Error("db down"));
    await expect(sitemap()).resolves.toHaveLength(3);
  });

  it("локальная разработка отдаётся по http", async () => {
    setHeaders({ host: "localhost:3000" });
    (prisma.newsItem.findFirst as any).mockResolvedValue(null);
    expect((await sitemap())[0].url).toBe("http://localhost:3000/");
  });
});
