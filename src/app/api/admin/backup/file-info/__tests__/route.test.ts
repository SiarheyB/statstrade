import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "@/app/api/admin/backup/file-info/route";

// NOTE: this route performs no auth check (admin gating is at the infra/proxy
// layer), so the standard unauth=401 case does not apply. We cover the real
// branches instead: missing filePath (400), existing file (200 w/ size),
// missing file (200 w/ size 0).
vi.mock("fs/promises", () => ({
  default: { stat: vi.fn() },
  stat: vi.fn(),
}));

import fs from "fs/promises";

const base = "https://example.com/api/admin/backup/file-info";

describe("POST /api/admin/backup/file-info", () => {
  beforeEach(() => {
    vi.mocked(fs.stat).mockReset();
  });

  it("returns 400 when filePath is missing", async () => {
    const res = await POST(new Request(base, {
      method: "POST",
      body: JSON.stringify({}),
    }));
    expect(res.status).toBe(400);
  });

  it("returns file size when the file exists", async () => {
    vi.mocked(fs.stat).mockResolvedValue({ size: 1234 } as any);
    const res = await POST(new Request(base, {
      method: "POST",
      body: JSON.stringify({ filePath: "dump.sql" }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.size).toBe(1234);
  });

  it("returns size 0 when the file does not exist", async () => {
    vi.mocked(fs.stat).mockRejectedValue(new Error("ENOENT"));
    const res = await POST(new Request(base, {
      method: "POST",
      body: JSON.stringify({ filePath: "missing.sql" }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.size).toBe(0);
  });
});
