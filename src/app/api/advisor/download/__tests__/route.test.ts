import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const readFile = vi.fn();
  return { ...actual, readFile, default: { ...actual, readFile } };
});

import { mockGetAuthUser } from "@/lib/__tests__/helpers/routeMocks";
import { readFile } from "node:fs/promises";
import { GET } from "@/app/api/advisor/download/route";

beforeEach(() => {
  mockGetAuthUser.mockReset();
  (readFile as any).mockReset();
});

describe("GET /api/advisor/download", () => {
  it("401 for guests and bots: no session, no file", async () => {
    mockGetAuthUser.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("403 for the demo session (not registered)", async () => {
    mockGetAuthUser.mockResolvedValue({ userId: "demo", email: "demo@x", demo: true });
    const res = await GET();
    expect(res.status).toBe(403);
    expect(readFile).not.toHaveBeenCalled();
  });

  it("sends the file as an attachment to a registered user", async () => {
    mockGetAuthUser.mockResolvedValue({ userId: "u-dl", email: "u@x" });
    (readFile as any).mockResolvedValue(Buffer.from([1, 2, 3]));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("TradeGridPanel.ex5");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("404 when the file is missing from the image", async () => {
    mockGetAuthUser.mockResolvedValue({ userId: "u-missing", email: "u@x" });
    (readFile as any).mockRejectedValue(new Error("ENOENT"));
    const res = await GET();
    expect(res.status).toBe(404);
  });
});
