import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asUser,
  asGuest,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";

vi.mock("@/lib/ratelimit", () => ({
  rateLimit: vi.fn().mockReturnValue({ ok: true, retryAfterSec: 0 }),
  clientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

vi.mock("@/lib/integrations/cloudStorage", () => ({
  getValidCloudToken: vi.fn(),
  firstConnectedProvider: vi.fn(),
}));

vi.mock("@/lib/integrations/googleDrive", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/googleDrive")>()),
  uploadImage: vi.fn(),
  makeFilePublic: vi.fn(),
  directImageUrl: vi.fn(),
  getOrCreateAppFolder: vi.fn(),
  getOrCreateNestedFolders: vi.fn(),
}));

vi.mock("@/lib/integrations/yandexDisk", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/yandexDisk")>()),
  uploadFile: vi.fn(),
  publishResource: vi.fn(),
  getPublicUrl: vi.fn(),
}));

vi.mock("@/lib/imageValidation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/imageValidation")>()),
  detectImageType: vi.fn(),
}));

vi.mock("@/lib/statsCache", () => ({
  bumpStatsVersion: vi.fn(),
}));

vi.mock("@/lib/errorLog", () => ({
  logError: vi.fn(),
}));

import { POST, DELETE } from "@/app/api/trade-images/route";
import { rateLimit } from "@/lib/ratelimit";
import { getValidCloudToken, firstConnectedProvider } from "@/lib/integrations/cloudStorage";
import {
  uploadImage,
  makeFilePublic,
  directImageUrl,
  getOrCreateAppFolder,
  getOrCreateNestedFolders,
  GoogleDriveError,
} from "@/lib/integrations/googleDrive";
import { uploadFile, publishResource, getPublicUrl } from "@/lib/integrations/yandexDisk";
import { detectImageType } from "@/lib/imageValidation";

const base = "https://example.com/api/trade-images";

// jsdom's Request does not implement formData() for multipart bodies; pass a
// minimal request stub whose formData() returns our prepared FormData.
function makeFormRequest(fields: Record<string, string | File>): any {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v as any);
  return { url: base, formData: async () => form };
}

function makeBadFormRequest(): any {
  return {
    url: base,
    formData: async () => {
      throw new Error("not multipart");
    },
  };
}

function pngFile(name = "a.png", size = 100): File {
  const bytes = new Uint8Array(size);
  // PNG signature
  bytes[0] = 0x89; bytes[1] = 0x50; bytes[2] = 0x4e; bytes[3] = 0x47;
  return new File([bytes], name, { type: "image/png" });
}

describe("POST /api/trade-images", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    vi.clearAllMocks();
    asUser();
    (rateLimit as any).mockReturnValue({ ok: true, retryAfterSec: 0 });
    (detectImageType as any).mockReturnValue("image/png");
    mockPrisma.tradeAnnotation.upsert.mockResolvedValue({});
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await POST(makeFormRequest({ tradeKey: "k1", file: pngFile() }));
    expect(res.status).toBe(401);
  });

  it("returns 429 when rate limited", async () => {
    (rateLimit as any).mockReturnValue({ ok: false, retryAfterSec: 60 });
    const res = await POST(makeFormRequest({ tradeKey: "k1", file: pngFile() }));
    expect(res.status).toBe(429);
  });

  it("returns 400 for non-multipart body", async () => {
    const res = await POST(makeBadFormRequest());
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing/invalid tradeKey", async () => {
    const res = await POST(makeFormRequest({ tradeKey: "", file: pngFile() }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when file missing", async () => {
    const res = await POST(makeFormRequest({ tradeKey: "k1" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when file too large", async () => {
    const big = pngFile("big.png", 11 * 1024 * 1024);
    const res = await POST(makeFormRequest({ tradeKey: "k1", file: big }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when no cloud provider connected", async () => {
    (firstConnectedProvider as any).mockResolvedValue(null);
    const res = await POST(makeFormRequest({ tradeKey: "k1", file: pngFile() }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when access token invalid", async () => {
    (firstConnectedProvider as any).mockResolvedValue("google_drive");
    (getValidCloudToken as any).mockResolvedValue(null);
    const res = await POST(makeFormRequest({ tradeKey: "k1", file: pngFile() }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when file is not a recognized image", async () => {
    (firstConnectedProvider as any).mockResolvedValue("google_drive");
    (getValidCloudToken as any).mockResolvedValue("tok");
    (detectImageType as any).mockReturnValue(null);
    const res = await POST(makeFormRequest({ tradeKey: "k1", file: pngFile() }));
    expect(res.status).toBe(400);
  });

  it("happy path uploads to google drive", async () => {
    (firstConnectedProvider as any).mockResolvedValue("google_drive");
    (getValidCloudToken as any).mockResolvedValue("tok");
    (getOrCreateAppFolder as any).mockResolvedValue("folder1");
    (getOrCreateNestedFolders as any).mockResolvedValue("folder2");
    (uploadImage as any).mockResolvedValue({ id: "file1" });
    (makeFilePublic as any).mockResolvedValue(undefined);
    (directImageUrl as any).mockReturnValue("https://drive/file1");

    const res = await POST(
      makeFormRequest({
        tradeKey: "k1",
        file: pngFile(),
        symbol: "BTCUSD",
        entryTime: "2024-01-01T10:00:00Z",
        result: "win",
        pattern: "flag",
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imageUrl).toBe("https://drive/file1");
    expect(body.imageProvider).toBe("google_drive");
    expect(mockPrisma.tradeAnnotation.upsert).toHaveBeenCalledOnce();
  });

  it("happy path uploads to yandex disk", async () => {
    (firstConnectedProvider as any).mockResolvedValue("yandex_disk");
    (getValidCloudToken as any).mockResolvedValue("tok");
    (uploadFile as any).mockResolvedValue({ path: "/tradestats_deal/file.png" });
    (publishResource as any).mockResolvedValue(undefined);
    (getPublicUrl as any).mockResolvedValue("https://yandex/public");

    const res = await POST(makeFormRequest({ tradeKey: "k1", file: pngFile() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imageUrl).toContain("/api/trade-images/view?tradeKey=");
    expect(body.imageProvider).toBe("yandex_disk");
  });

  it("returns 400 on GoogleDriveError during upload", async () => {
    (firstConnectedProvider as any).mockResolvedValue("google_drive");
    (getValidCloudToken as any).mockResolvedValue("tok");
    (getOrCreateAppFolder as any).mockRejectedValue(new GoogleDriveError("quota exceeded"));

    const res = await POST(makeFormRequest({ tradeKey: "k1", file: pngFile() }));
    expect(res.status).toBe(400);
  });

  it("returns 500 on unexpected error during upload", async () => {
    (firstConnectedProvider as any).mockResolvedValue("google_drive");
    (getValidCloudToken as any).mockResolvedValue("tok");
    (getOrCreateAppFolder as any).mockRejectedValue(new Error("boom"));

    const res = await POST(makeFormRequest({ tradeKey: "k1", file: pngFile() }));
    expect(res.status).toBe(500);
  });
});

describe("DELETE /api/trade-images", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    vi.clearAllMocks();
    asUser();
    mockPrisma.tradeAnnotation.updateMany.mockResolvedValue({ count: 1 });
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await DELETE(new Request(`${base}?tradeKey=k1`, { method: "DELETE" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when tradeKey missing", async () => {
    const res = await DELETE(new Request(base, { method: "DELETE" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when tradeKey too long", async () => {
    const longKey = "a".repeat(201);
    const res = await DELETE(new Request(`${base}?tradeKey=${longKey}`, { method: "DELETE" }));
    expect(res.status).toBe(400);
  });

  it("clears the link on happy path", async () => {
    const res = await DELETE(new Request(`${base}?tradeKey=k1`, { method: "DELETE" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockPrisma.tradeAnnotation.updateMany).toHaveBeenCalledOnce();
  });

  it("returns 500 when prisma throws", async () => {
    mockPrisma.tradeAnnotation.updateMany.mockRejectedValue(new Error("db down"));
    const res = await DELETE(new Request(`${base}?tradeKey=k1`, { method: "DELETE" }));
    expect(res.status).toBe(500);
  });
});
