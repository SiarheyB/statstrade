import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asGuest,
  asAdmin,
  asNonAdmin,
  mockGetAdminSession,
  mockGetAuthUser,
  mockRecordAudit,
} from "@/lib/__tests__/helpers/routeMocks";
import { POST } from "@/app/api/admin/content/route";

vi.mock("@/lib/news", () => ({ refreshNews: vi.fn().mockResolvedValue([]) }));
vi.mock("@/lib/econcal", () => ({ refreshCalendar: vi.fn().mockResolvedValue([]) }));

const base = "https://example.com/api/admin/content";

beforeEach(() => {
  mockGetAuthUser.mockReset();
  mockGetAdminSession.mockReset();
  mockRecordAudit.mockReset();
});

describe("POST /api/admin/content", () => {
  it("returns 404 when no admin session", async () => {
    asNonAdmin();
    asGuest();
    const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({ feed: "news" }) }));
    expect(res.status).toBe(404);
  });

  it("returns 400 for unknown feed", async () => {
    asAdmin();
    asGuest();
    const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({ feed: "bogus" }) }));
    expect(res.status).toBe(400);
  });

  it("refreshes news feed for admin", async () => {
    asAdmin();
    asGuest();
    const { refreshNews } = await import("@/lib/news");
    vi.mocked(refreshNews).mockResolvedValue([{ added: 3 }]);
    const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({ feed: "news" }) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockRecordAudit).toHaveBeenCalled();
  });

  it("refreshes econcal feed for admin", async () => {
    asAdmin();
    asGuest();
    const { refreshCalendar } = await import("@/lib/econcal");
    vi.mocked(refreshCalendar).mockResolvedValueOnce([{ upserted: 5 }]);
    const res = await POST(new Request(base, { method: "POST", body: JSON.stringify({ feed: "econcal" }) }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });
});
