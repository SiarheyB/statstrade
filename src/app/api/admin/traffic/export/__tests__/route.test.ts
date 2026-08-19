import { describe, it, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/admin/traffic/export/route";

const admin = { userId: "u1", email: "admin@example.com" };
const requireAdmin = vi.fn();
vi.mock("@/lib/admin", () => ({ requireAdmin: () => requireAdmin() }));

vi.mock("@/lib/traffic/query", () => ({
  getSeries: vi.fn().mockResolvedValue([
    { bucket: "2026-08-18T00:00:00.000Z", humanViews: 10, humanVisitors: 4, botViews: 2 },
  ]),
  getTopPages: vi.fn().mockResolvedValue([{ path: "/news; спец", views: 5, visitors: 3, entries: 2, bounceRate: 0.5 }]),
  getSources: vi.fn().mockResolvedValue([]),
  getBots: vi.fn().mockResolvedValue([]),
  getRecentVisits: vi.fn().mockResolvedValue([]),
}));

const url = (q: string) => new Request(`https://example.com/api/admin/traffic/export?${q}`);

describe("GET /api/admin/traffic/export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireAdmin.mockResolvedValue(admin);
  });

  it("не пускает не-админа", async () => {
    requireAdmin.mockResolvedValue(new Response("no", { status: 401 }));
    expect((await GET(url("what=days"))).status).toBe(401);
  });

  it("отдаёт CSV вложением с говорящим именем файла", async () => {
    const res = await GET(url("what=days&p=30d&a=human&tz=180"));
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("traffic-days-30d-");
    const body = await res.text();
    expect(body).toContain("Просмотры (люди)");
    expect(body).toContain("10;4;2");
  });

  it("экранирует разделитель внутри значений (путь с точкой с запятой)", async () => {
    const body = await (await GET(url("what=pages"))).text();
    expect(body).toContain('"/news; спец"');
  });

  it("мусор в параметрах не ломает выгрузку — берётся вариант по умолчанию", async () => {
    const res = await GET(url("what=хакер&p=хакер&a=хакер"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toContain("traffic-days-30d-");
  });
});
