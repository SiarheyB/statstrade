import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asUser,
  asGuest,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";

vi.mock("@/lib/integrations/cloudStorage", () => ({
  getValidCloudToken: vi.fn(),
}));

vi.mock("@/lib/integrations/yandexDisk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/yandexDisk")>()),
  getFreshDownloadHref: vi.fn(),
}));

vi.mock("@/lib/errorLog", () => ({
  logError: vi.fn(),
}));

import { GET } from "@/app/api/trade-images/view/route";
import { getValidCloudToken } from "@/lib/integrations/cloudStorage";
import { getFreshDownloadHref, YandexDiskError } from "@/lib/integrations/yandexDisk";

const base = "https://example.com/api/trade-images/view";

describe("GET /api/trade-images/view", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    vi.clearAllMocks();
    asUser();
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET(new Request(`${base}?tradeKey=k1`));
    expect(res.status).toBe(401);
  });

  it("returns 400 when tradeKey missing", async () => {
    const res = await GET(new Request(base));
    expect(res.status).toBe(400);
  });

  it("returns 400 when tradeKey too long", async () => {
    const longKey = "a".repeat(201);
    const res = await GET(new Request(`${base}?tradeKey=${longKey}`));
    expect(res.status).toBe(400);
  });

  it("returns 400 when annotation not found or not yandex_disk", async () => {
    mockPrisma.tradeAnnotation.findUnique.mockResolvedValue(null);
    const res = await GET(new Request(`${base}?tradeKey=k1`));
    expect(res.status).toBe(400);
  });

  it("returns 400 when annotation provider is not yandex_disk", async () => {
    mockPrisma.tradeAnnotation.findUnique.mockResolvedValue({
      imageProvider: "google_drive",
      imageFileId: "someid",
      imageUrl: "https://x",
    });
    const res = await GET(new Request(`${base}?tradeKey=k1`));
    expect(res.status).toBe(400);
  });

  it("returns 400 when yandex disk not connected (no token)", async () => {
    mockPrisma.tradeAnnotation.findUnique.mockResolvedValue({
      imageProvider: "yandex_disk",
      imageFileId: "/path/to/file.png",
      imageUrl: "/api/trade-images/view?tradeKey=k1",
    });
    (getValidCloudToken as any).mockResolvedValue(null);
    const res = await GET(new Request(`${base}?tradeKey=k1`));
    expect(res.status).toBe(400);
  });

  it("redirects to fresh download href on happy path", async () => {
    mockPrisma.tradeAnnotation.findUnique.mockResolvedValue({
      imageProvider: "yandex_disk",
      imageFileId: "/path/to/file.png",
      imageUrl: "/api/trade-images/view?tradeKey=k1",
    });
    (getValidCloudToken as any).mockResolvedValue("tok");
    (getFreshDownloadHref as any).mockResolvedValue("https://yandex.disk/fresh-url");

    const res = await GET(new Request(`${base}?tradeKey=k1`));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://yandex.disk/fresh-url");
  });

  it("returns 400 on YandexDiskError", async () => {
    mockPrisma.tradeAnnotation.findUnique.mockResolvedValue({
      imageProvider: "yandex_disk",
      imageFileId: "/path/to/file.png",
      imageUrl: "/api/trade-images/view?tradeKey=k1",
    });
    (getValidCloudToken as any).mockResolvedValue("tok");
    (getFreshDownloadHref as any).mockRejectedValue(new YandexDiskError("bad token"));

    const res = await GET(new Request(`${base}?tradeKey=k1`));
    expect(res.status).toBe(400);
  });

  it("returns 500 on unexpected error", async () => {
    mockPrisma.tradeAnnotation.findUnique.mockResolvedValue({
      imageProvider: "yandex_disk",
      imageFileId: "/path/to/file.png",
      imageUrl: "/api/trade-images/view?tradeKey=k1",
    });
    (getValidCloudToken as any).mockResolvedValue("tok");
    (getFreshDownloadHref as any).mockRejectedValue(new Error("boom"));

    const res = await GET(new Request(`${base}?tradeKey=k1`));
    expect(res.status).toBe(500);
  });
});
