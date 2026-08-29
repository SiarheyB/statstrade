import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  newsFindMany: vi.fn(),
  imageFindMany: vi.fn(),
  imageUpsert: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    newsItem: { findMany: mocks.newsFindMany },
    newsImage: { findMany: mocks.imageFindMany, upsert: mocks.imageUpsert },
  },
}));

import sharp from "sharp";
import { withLocalCovers, cacheMissingCovers, newsImageSrc, isSafeCoverUrl } from "@/lib/newsImages";

/** Настоящая картинка — конвейер sharp проверяем на деле, а не на моке. */
async function pngBytes(width = 600, height = 400): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 20, g: 140, b: 90 } },
  })
    .png()
    .toBuffer();
}

function okResponse(body: Buffer) {
  return {
    ok: true,
    headers: { get: (h: string) => (h === "content-length" ? String(body.byteLength) : null) },
    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.imageUpsert.mockResolvedValue({});
});

describe("withLocalCovers", () => {
  it("подменяет ссылку только у новостей с сохранённой обложкой", async () => {
    mocks.imageFindMany.mockResolvedValue([{ newsId: "a" }]);
    const items = [
      { id: "a", imageUrl: "https://cdn.example/a.jpg" },
      { id: "b", imageUrl: "https://cdn.example/b.jpg" },
    ];
    const out = await withLocalCovers(items);
    expect(out[0].imageUrl).toBe(newsImageSrc("a"));
    // Ещё не скачали — остаётся внешний CDN, карточка не пустеет.
    expect(out[1].imageUrl).toBe("https://cdn.example/b.jpg");
  });

  it("не ходит в базу, когда картинок нет вовсе", async () => {
    const out = await withLocalCovers([{ id: "a", imageUrl: null }]);
    expect(out[0].imageUrl).toBeNull();
    expect(mocks.imageFindMany).not.toHaveBeenCalled();
  });
});

describe("cacheMissingCovers", () => {
  it("скачивает, ужимает в webp и сохраняет", async () => {
    mocks.newsFindMany.mockResolvedValue([{ id: "n1", imageUrl: "https://cdn.example/big.png" }]);
    const big = await pngBytes();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(big)));

    const res = await cacheMissingCovers();
    expect(res).toEqual({ saved: 1, failed: 0 });

    const saved = mocks.imageUpsert.mock.calls[0][0].create;
    expect(saved.newsId).toBe("n1");
    expect(saved.width).toBe(320);
    // Ради этого всё и затевалось: обложка должна стать заметно легче.
    expect(saved.bytes).toBeLessThan(big.byteLength);
    const meta = await sharp(saved.data).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(320);
  });

  it("считает неудачу, а не падает, если источник не отдал картинку", async () => {
    mocks.newsFindMany.mockResolvedValue([{ id: "n1", imageUrl: "https://cdn.example/404.png" }]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, headers: { get: () => null } }));

    await expect(cacheMissingCovers()).resolves.toEqual({ saved: 0, failed: 1 });
    expect(mocks.imageUpsert).not.toHaveBeenCalled();
  });

  it("не тянет в память гигантский файл", async () => {
    mocks.newsFindMany.mockResolvedValue([{ id: "n1", imageUrl: "https://cdn.example/huge.png" }]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: (h: string) => (h === "content-length" ? String(50 * 1024 * 1024) : null) },
      arrayBuffer: async () => {
        throw new Error("не должно дойти до чтения тела");
      },
    }));

    await expect(cacheMissingCovers()).resolves.toEqual({ saved: 0, failed: 1 });
  });

  it("ничего не делает, когда все обложки уже сохранены", async () => {
    mocks.newsFindMany.mockResolvedValue([]);
    await expect(cacheMissingCovers()).resolves.toEqual({ saved: 0, failed: 0 });
  });
});

describe("isSafeCoverUrl", () => {
  // Адрес приходит из ЧУЖОГО RSS-фида, а скачиваем мы его с сервера — изнутри
  // сети, где живут коллектор, Postgres и сам app.
  it("пускает обычные CDN-адреса", () => {
    for (const ok of [
      "https://cdn.coindesk.com/a.jpg",
      "https://images.example.co.uk/x/y.png?v=2",
      "https://8.8.8.8/pic.jpg",
      // Домены, начинающиеся с fc/fd: раньше проверка префикса IPv6-ULA
      // применялась к ЛЮБОМУ имени и резала обычные CDN.
      "https://fcdn.example.com/a.jpg",
      "https://fd-media.example.com/a.jpg",
    ]) {
      expect(isSafeCoverUrl(ok), ok).toBe(true);
    }
  });

  it("не пускает внутрь сети и на нешифрованный протокол", () => {
    for (const bad of [
      "http://cdn.example.com/a.jpg",        // не https
      "https://localhost/a.jpg",
      "https://collector:8080/metrics",      // имя сервиса в compose-сети
      "https://db/a.jpg",
      "https://127.0.0.1/a.jpg",
      "https://10.1.2.3/a.jpg",
      "https://192.168.0.1/a.jpg",
      "https://172.16.0.1/a.jpg",
      "https://169.254.169.254/latest/meta-data/",  // метаданные облака
      "https://[::1]/a.jpg",
      "https://[fd00::1]/a.jpg",              // IPv6 ULA — настоящий адрес
      "https://[fe80::1]/a.jpg",              // IPv6 link-local
      "https://100.100.100.100/a.jpg",        // 100.64/10 — tailnet
      "https://100.64.0.1/a.jpg",
      "file:///etc/passwd",
      "не адрес вовсе",
      "",
    ]) {
      expect(isSafeCoverUrl(bad), bad).toBe(false);
    }
  });

  it("публичные адреса рядом с приватными диапазонами не отсекаются", () => {
    // 172.32.x лежит ЗА пределами 172.16-31, это публичный адрес.
    expect(isSafeCoverUrl("https://172.32.0.1/a.jpg")).toBe(true);
    expect(isSafeCoverUrl("https://192.169.0.1/a.jpg")).toBe(true);
    // 100.63 и 100.128 лежат ЗА пределами CGNAT-диапазона 100.64-127.
    expect(isSafeCoverUrl("https://100.63.0.1/a.jpg")).toBe(true);
    expect(isSafeCoverUrl("https://100.128.0.1/a.jpg")).toBe(true);
  });
});
