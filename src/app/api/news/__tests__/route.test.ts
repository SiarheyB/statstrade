import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asUser,
  asGuest,
  mockGetAuthUser,
} from "@/lib/__tests__/helpers/routeMocks";
import { GET } from "@/app/api/news/route";

vi.mock("@/lib/news", () => ({
  getUnreadNews: vi.fn(),
  markRead: vi.fn(),
  getNews: vi.fn(),
}));

const base = "https://example.com/api/news";

describe("GET /api/news", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    vi.mocked(require("@/lib/news").getUnreadNews).mockReset();
    vi.mocked(require("@/lib/news").getNews).mockReset();
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET(new Request(base));
    expect(res.status).toBe(401);
  });

  it("returns unread count for authenticated user", async () => {
    asUser();
    vi.mocked(require("@/lib/news").getUnreadNews).mockResolvedValue({ count: 5 });
    const res = await GET(new Request(base));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(5);
  });

  it("returns news items for authenticated user", async () => {
    asUser();
    vi.mocked(require("@/lib/news").getNews).mockResolvedValue([
      { id: "1", title: "News 1", text: "Content 1" },
      { id: "2", title: "News 2", text: "Content 2" },
    ]);
    const res = await GET(new Request(base));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.news).toHaveLength(2);
    expect(body.news[0].id).toBe("1");
    expect(body.news[1].id).toBe("2");
  });
});

describe("POST /api/news/read (mocked)", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    vi.mocked(require("@/lib/news").markRead).mockReset();
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await POST(new Request(base, { method: "POST" }));
    expect(res.status).toBe(401);
  });

  it("marks news as read for authenticated user", async () => {
    asUser();
    const res = await POST(new Request(base, {
      method: "POST",
      body: JSON.stringify({ ids: ["1", "2"] }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(vi.mocked(require("@/lib/news").markRead)).toHaveBeenCalledWith("u1", ["1", "2"]);
  });
});