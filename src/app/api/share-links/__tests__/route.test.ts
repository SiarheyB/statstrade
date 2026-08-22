import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  asUser,
  asGuest,
  mockGetAuthUser,
  mockPrisma,
} from "@/lib/__tests__/helpers/routeMocks";
import { GET, POST, DELETE } from "@/app/api/share-links/route";

vi.mock("@/lib/featureConfig", () => ({
  getFeatureConfig: vi.fn(),
}));
vi.mock("@/lib/mentorShare", async (importOriginal) => ({
  // parseRangeDate — чистая функция без обращений к базе, берём настоящую:
  // проверять хочется именно то, что уедет в Prisma.
  ...(await importOriginal<typeof import("@/lib/mentorShare")>()),
  generateShareToken: vi.fn(() => "tok123"),
}));

import * as featureConfig from "@/lib/featureConfig";

// Augment shared prisma mock with the shareLink model.
mockPrisma.shareLink = {
  findMany: vi.fn().mockResolvedValue([]),
  count: vi.fn().mockResolvedValue(0),
  create: vi.fn().mockResolvedValue({}),
  updateMany: vi.fn().mockResolvedValue({ count: 0 }),
};

const base = "https://example.com/api/share-links";

const mockLink = {
  id: "link-1",
  userId: "u1",
  token: "tok123",
  label: "Mentor link",
  revokedAt: null,
  createdAt: new Date(),
};

describe("GET /api/share-links", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    vi.mocked(featureConfig.getFeatureConfig).mockResolvedValue({ enabled: true, maxLinksPerUser: 5 } as any);
    mockPrisma.shareLink.findMany.mockResolvedValue([mockLink as any]);
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns 404 when mentorMode feature disabled", async () => {
    asUser();
    vi.mocked(featureConfig.getFeatureConfig).mockResolvedValue({ enabled: false, maxLinksPerUser: 0 } as any);
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("returns links for the user", async () => {
    asUser();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.links)).toBe(true);
    expect(body.links.length).toBe(1);
    expect(body.maxLinksPerUser).toBe(5);
  });
});

describe("POST /api/share-links", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    vi.mocked(featureConfig.getFeatureConfig).mockResolvedValue({ enabled: true, maxLinksPerUser: 5 } as any);
    mockPrisma.shareLink.count.mockResolvedValue(0);
    mockPrisma.shareLink.create.mockResolvedValue(mockLink as any);
    mockPrisma.exchangeAccount.findFirst.mockResolvedValue(null);
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await POST(new Request(base, { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when limit reached", async () => {
    asUser();
    mockPrisma.shareLink.count.mockResolvedValue(5);
    const res = await POST(new Request(base, { method: "POST", body: "{}" }));
    expect(res.status).toBe(400);
  });

  it("creates a share link on valid request", async () => {
    asUser();
    const res = await POST(new Request(base, {
      method: "POST",
      body: JSON.stringify({ label: "Mentor link" }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.link.token).toBe("tok123");
    expect(mockPrisma.shareLink.create).toHaveBeenCalledOnce();
  });
});

describe("DELETE /api/share-links", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    mockPrisma.shareLink.updateMany.mockResolvedValue({ count: 1 } as any);
  });

  it("returns 401 when not authenticated", async () => {
    asGuest();
    const res = await DELETE(new Request(`${base}?id=link-1`));
    expect(res.status).toBe(401);
  });

  it("returns 400 when id is missing", async () => {
    asUser();
    const res = await DELETE(new Request(base));
    expect(res.status).toBe(400);
  });

  it("revokes a share link by id", async () => {
    asUser();
    const res = await DELETE(new Request(`${base}?id=link-1`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockPrisma.shareLink.updateMany).toHaveBeenCalledOnce();
  });
});

// Ссылку можно сузить до одного счёта (ShareLink.accountId), а без него она
// показывает сделки всех счетов сразу — как вели себя все ссылки раньше.
describe("POST /api/share-links — выбор счёта", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    vi.mocked(featureConfig.getFeatureConfig).mockResolvedValue({ enabled: true, maxLinksPerUser: 5 } as any);
    mockPrisma.shareLink.count.mockResolvedValue(0);
    mockPrisma.shareLink.create.mockClear().mockResolvedValue(mockLink as any);
    mockPrisma.exchangeAccount.findFirst.mockClear().mockResolvedValue(null);
  });
  it("привязывает ссылку к счёту, если он принадлежит пользователю", async () => {
    asUser();
    mockPrisma.exchangeAccount.findFirst.mockResolvedValue({ id: "a1" } as any);

    const res = await POST(
      new Request("http://x/api/share-links", {
        method: "POST",
        body: JSON.stringify({ label: "Для наставника", accountId: "a1" }),
      }),
    );

    expect(res.status).toBe(200);
    expect(mockPrisma.shareLink.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ accountId: "a1" }) }),
    );
    // Счёт ищем только среди своих — иначе ссылка открыла бы чужие сделки.
    expect(mockPrisma.exchangeAccount.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: "a1", userId: "u1" }) }),
    );
  });

  it("отказывает, если счёт чужой или удалён", async () => {
    asUser();
    mockPrisma.exchangeAccount.findFirst.mockResolvedValue(null);

    const res = await POST(
      new Request("http://x/api/share-links", {
        method: "POST",
        body: JSON.stringify({ accountId: "someone-else" }),
      }),
    );

    expect(res.status).toBe(400);
    expect(mockPrisma.shareLink.create).not.toHaveBeenCalled();
  });

  it("без счёта создаёт ссылку на все счета сразу", async () => {
    asUser();

    const res = await POST(
      new Request("http://x/api/share-links", { method: "POST", body: JSON.stringify({}) }),
    );

    expect(res.status).toBe(200);
    expect(mockPrisma.shareLink.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ accountId: null }) }),
    );
    // Лишнего запроса в базу за счётом не делаем.
    expect(mockPrisma.exchangeAccount.findFirst).not.toHaveBeenCalled();
  });

  it("сохраняет выбранные даты периода", async () => {
    asUser();

    const res = await POST(
      new Request("http://x/api/share-links", {
        method: "POST",
        body: JSON.stringify({ periodFrom: "2026-06-01", periodTo: "2026-06-30" }),
      }),
    );

    expect(res.status).toBe(200);
    const { data } = mockPrisma.shareLink.create.mock.calls[0][0];
    expect(data.periodFrom).toEqual(new Date("2026-06-01T00:00:00.000Z"));
    // Конец — начало следующих суток, чтобы 30 июня попало в выборку целиком.
    expect(data.periodTo).toEqual(new Date("2026-07-01T00:00:00.000Z"));
  });

  it("без дат создаёт ссылку на всю историю", async () => {
    asUser();

    await POST(new Request("http://x/api/share-links", { method: "POST", body: JSON.stringify({}) }));

    const { data } = mockPrisma.shareLink.create.mock.calls[0][0];
    expect(data.periodFrom).toBeNull();
    expect(data.periodTo).toBeNull();
  });

  it("отклоняет перепутанные местами даты", async () => {
    asUser();

    const res = await POST(
      new Request("http://x/api/share-links", {
        method: "POST",
        body: JSON.stringify({ periodFrom: "2026-07-01", periodTo: "2026-06-01" }),
      }),
    );

    expect(res.status).toBe(400);
    expect(mockPrisma.shareLink.create).not.toHaveBeenCalled();
  });

  it("отклоняет дату не в формате календаря", async () => {
    asUser();

    const res = await POST(
      new Request("http://x/api/share-links", {
        method: "POST",
        body: JSON.stringify({ periodFrom: "01.06.2026" }),
      }),
    );

    expect(res.status).toBe(400);
    expect(mockPrisma.shareLink.create).not.toHaveBeenCalled();
  });

  it("сохраняет срок жизни ссылки", async () => {
    asUser();
    const before = Date.now();

    await POST(
      new Request("http://x/api/share-links", {
        method: "POST",
        body: JSON.stringify({ ttlUnit: "days", ttlValue: 102 }),
      }),
    );

    const { data } = mockPrisma.shareLink.create.mock.calls[0][0];
    const expected = before + 102 * 86_400_000;
    // Момент истечения считается от «сейчас», поэтому сверяем с допуском.
    expect(Math.abs((data.expiresAt as Date).getTime() - expected)).toBeLessThan(5_000);
  });

  it("без срока создаёт бессрочную ссылку", async () => {
    asUser();

    await POST(new Request("http://x/api/share-links", { method: "POST", body: JSON.stringify({}) }));

    expect(mockPrisma.shareLink.create.mock.calls[0][0].data.expiresAt).toBeNull();
  });

  it("отклоняет срок без числа и число вне допустимого", async () => {
    asUser();

    const noValue = await POST(
      new Request("http://x/api/share-links", { method: "POST", body: JSON.stringify({ ttlUnit: "hours" }) }),
    );
    expect(noValue.status).toBe(400);

    const zero = await POST(
      new Request("http://x/api/share-links", {
        method: "POST",
        body: JSON.stringify({ ttlUnit: "days", ttlValue: 0 }),
      }),
    );
    expect(zero.status).toBe(400);
    expect(mockPrisma.shareLink.create).not.toHaveBeenCalled();
  });
});
