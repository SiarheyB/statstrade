import { describe, it, expect, beforeEach } from "vitest";
import {
  asUser,
  asGuest,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { GET, PUT } from "@/app/api/settings/route";

const base = "https://example.com/api/settings";

describe("GET /api/settings", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    mockPrisma.user.findUnique.mockResolvedValue({
      entryPointOptions: JSON.stringify(["breakout", "pullback"]),
      entryTypeOptions: JSON.stringify(["market", "limit"]),
      mistakeOptions: JSON.stringify(["fomo", "revenge"]),
      patternOptions: JSON.stringify(["double_top", "head_shoulders"]),
    });
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET(new Request(base));
    expect(res.status).toBe(401);
  });

  it("returns parsed options for authenticated user", async () => {
    asUser();
    const res = await GET(new Request(base));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entryPointOptions).toEqual(["breakout", "pullback"]);
    expect(body.entryTypeOptions).toEqual(["market", "limit"]);
    expect(body.mistakeOptions).toEqual(["fomo", "revenge"]);
    expect(body.patternOptions).toEqual(["double_top", "head_shoulders"]);
  });

  it("returns defaults when no options stored", async () => {
    asUser();
    mockPrisma.user.findUnique.mockResolvedValue(null);
    const res = await GET(new Request(base));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.entryPointOptions)).toBe(true);
    expect(Array.isArray(body.entryTypeOptions)).toBe(true);
  });
});

describe("PUT /api/settings", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    mockPrisma.user.findUnique.mockResolvedValue(null);
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await PUT(new Request(base, { method: "PUT", body: JSON.stringify({}) }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for malformed JSON", async () => {
    asUser();
    const res = await PUT(new Request(base, { method: "PUT", body: "not-json" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid options (too many items)", async () => {
    asUser();
    const tooMany = Array.from({ length: 50 }, (_, i) => `opt${i}`);
    const res = await PUT(
      new Request(base, {
        method: "PUT",
        body: JSON.stringify({
          entryPointOptions: tooMany,
          entryTypeOptions: [],
          mistakeOptions: [],
          patternOptions: [],
        }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("saves valid options and returns them de-duplicated", async () => {
    asUser();
    mockPrisma.user.update.mockResolvedValue({ id: "user-1" });
    const res = await PUT(
      new Request(base, {
        method: "PUT",
        body: JSON.stringify({
          entryPointOptions: ["breakout", "pullback", "breakout"],
          entryTypeOptions: ["market"],
          mistakeOptions: ["fomo"],
          patternOptions: ["double_top"],
        }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entryPointOptions).toEqual(["breakout", "pullback"]);
    expect(mockPrisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "u1" },
        data: expect.objectContaining({
          entryPointOptions: JSON.stringify(["breakout", "pullback"]),
        }),
      })
    );
  });

  it("returns 500 when prisma fails", async () => {
    asUser();
    mockPrisma.user.update.mockRejectedValueOnce(new Error("DB error"));
    const res = await PUT(
      new Request(base, {
        method: "PUT",
        body: JSON.stringify({
          entryPointOptions: ["breakout"],
          entryTypeOptions: [],
          mistakeOptions: [],
          patternOptions: [],
        }),
      })
    );
    expect(res.status).toBe(500);
  });
});