import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asAdmin,
  asNonAdmin,
  mockGetAdminSession,
  mockRecordAudit,
} from "@/lib/__tests__/helpers/routeMocks";

vi.mock("fs/promises", () => ({
  default: { stat: vi.fn() },
  stat: vi.fn(),
}));

// Читать файл по-настоящему тесту незачем — важно, что роут отдаёт поток
// именно того файла, который попросили, и с правильными заголовками.
const createReadStreamMock = vi.hoisted(() => vi.fn());
vi.mock("fs", () => ({ default: { createReadStream: createReadStreamMock }, createReadStream: createReadStreamMock }));
vi.mock("stream", () => ({
  default: { Readable: { toWeb: () => new ReadableStream() } },
  Readable: { toWeb: () => new ReadableStream() },
}));

import fs from "fs/promises";
import { GET } from "@/app/api/admin/backup/download/route";

const base = "https://example.com/api/admin/backup/download";
const asFile = (size = 1234) => ({ isFile: () => true, size }) as unknown as Awaited<ReturnType<typeof fs.stat>>;

describe("/api/admin/backup/download", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAdminSession.mockReset();
    asAdmin();
  });

  it("не отвечает никому, кроме админа", async () => {
    asNonAdmin();
    const res = await GET(new Request(`${base}?file=dump.sql`));
    expect(res.status).toBe(404);
  });

  it("отдаёт файл вложением и пишет в аудит", async () => {
    vi.mocked(fs.stat).mockResolvedValue(asFile(4096));
    const res = await GET(new Request(`${base}?file=db-export_20260824.sql`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="db-export_20260824.sql"');
    expect(res.headers.get("content-length")).toBe("4096");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(createReadStreamMock).toHaveBeenCalledWith(expect.stringContaining("db-export_20260824.sql"));
    expect(mockRecordAudit).toHaveBeenCalled();
  });

  it("404, если файла нет", async () => {
    vi.mocked(fs.stat).mockRejectedValue(new Error("ENOENT"));
    const res = await GET(new Request(`${base}?file=missing.sql`));
    expect(res.status).toBe(404);
  });

  it("не выпускает за каталог бэкапов и не отдаёт чужие расширения", async () => {
    vi.mocked(fs.stat).mockResolvedValue(asFile());
    for (const name of ["../../.env", "/etc/passwd", "dump.sql/../../x.sql", "app.log", ".hidden.sql", ""]) {
      const res = await GET(new Request(`${base}?file=${encodeURIComponent(name)}`));
      expect(res.status, name).toBe(400);
    }
    expect(createReadStreamMock).not.toHaveBeenCalled();
  });

  it("каталог под видом файла не отдаётся", async () => {
    vi.mocked(fs.stat).mockResolvedValue({ isFile: () => false, size: 0 } as unknown as Awaited<ReturnType<typeof fs.stat>>);
    const res = await GET(new Request(`${base}?file=weird.sql`));
    expect(res.status).toBe(400);
  });
});
