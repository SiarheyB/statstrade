import { describe, it, expect, beforeEach } from "vitest";
import { asUser, asGuest, mockGetAuthUser, mockPrisma } from "@/lib/__tests__/helpers/routeMocks";
import { GET, POST } from "@/app/api/notifications/route";

const base = "https://example.com/api/notifications";

const post = (body: unknown) =>
  new Request(base, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("/api/notifications", () => {
  beforeEach(() => {
    mockGetAuthUser.mockReset();
    mockPrisma.userNotification.findMany.mockReset().mockResolvedValue([]);
    mockPrisma.userNotification.updateMany.mockReset().mockResolvedValue({ count: 1 });
  });

  it("гостя не пускает — ни читать, ни отмечать", async () => {
    asGuest();
    expect((await GET()).status).toBe(401);
    expect((await POST(post({ all: true }))).status).toBe(401);
  });

  it("отдаёт только уведомления текущего пользователя, новые сверху", async () => {
    asUser({ userId: "u1" });
    await GET();
    const args = mockPrisma.userNotification.findMany.mock.calls.at(-1)![0];
    expect(args.where).toEqual({ userId: "u1" });
    expect(args.orderBy).toEqual({ createdAt: "desc" });
  });

  it("отметка по id ограничена владельцем", async () => {
    // Без userId в условии чужой id пометил бы чужое уведомление прочитанным —
    // ровно та дыра, ради которой этот тест и написан.
    asUser({ userId: "u1" });
    const res = await POST(post({ id: "n-777" }));
    expect(res.status).toBe(200);
    const args = mockPrisma.userNotification.updateMany.mock.calls.at(-1)![0];
    expect(args.where).toEqual({ userId: "u1", id: "n-777" });
    expect(args.data.readAt).toBeInstanceOf(Date);
  });

  it("«отметить все» трогает только непрочитанные этого пользователя", async () => {
    asUser({ userId: "u1" });
    await POST(post({ all: true }));
    const args = mockPrisma.userNotification.updateMany.mock.calls.at(-1)![0];
    expect(args.where).toEqual({ userId: "u1", readAt: null });
  });

  it("пустое тело ничего не меняет, а не помечает всё подряд", async () => {
    asUser({ userId: "u1" });
    const res = await POST(post({}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, updated: 0 });
    expect(mockPrisma.userNotification.updateMany).not.toHaveBeenCalled();
  });
});
