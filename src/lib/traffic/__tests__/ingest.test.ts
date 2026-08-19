import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { floodCheck, markConversion, recordHit, retentionDays } from "@/lib/traffic/ingest";
import type { TrafficHit } from "@/lib/traffic/hit";

vi.mock("@/lib/db", () => ({
  prisma: {
    pageView: { findFirst: vi.fn(), create: vi.fn() },
    visitSession: { upsert: vi.fn(), update: vi.fn() },
  },
}));

const hit = (over: Partial<TrafficHit> = {}): TrafficHit => ({
  path: "/",
  visitorId: `v-${Math.random()}`,
  sessionId: "s1",
  isBot: false,
  botName: null,
  botCategory: null,
  botReason: null,
  source: "direct",
  refHost: null,
  referrer: null,
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  device: "desktop",
  browser: "Chrome",
  os: "Windows 10/11",
  lang: "ru",
  country: null,
  authed: false,
  userId: null,
  userAgent: "UA",
  nav: "load",
  ...over,
});

describe("recordHit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.pageView.findFirst as any).mockResolvedValue(null);
  });

  it("пишет просмотр и открывает визит", async () => {
    expect(await recordHit(hit())).toBe("created");
    expect(prisma.pageView.create).toHaveBeenCalledOnce();
    const upsert = (prisma.visitSession.upsert as any).mock.calls[0][0];
    expect(upsert.create).toMatchObject({ views: 1, entryPath: "/", exitPath: "/" });
    expect(upsert.update).toMatchObject({ exitPath: "/", views: { increment: 1 } });
  });

  it("маячок не задваивает просмотр, уже записанный серверным счётчиком", async () => {
    (prisma.pageView.findFirst as any).mockResolvedValue({ id: "existing" });
    expect(await recordHit(hit({ js: true }))).toBe("duplicate");
    expect(prisma.pageView.create).not.toHaveBeenCalled();
    // Визит всё равно трогаем: маячок мог принести подтверждение «это человек».
    expect((prisma.visitSession.upsert as any).mock.calls[0][0].update.views).toBeUndefined();
  });

  it("серверный счётчик за дублями не ходит — лишний запрос к БД на каждый просмотр не нужен", async () => {
    await recordHit(hit());
    expect(prisma.pageView.findFirst).not.toHaveBeenCalled();
  });

  it("маячок помечает визит как человеческий и приносит экран", async () => {
    await recordHit(hit({ js: true, screen: "1920x1080" }));
    const upsert = (prisma.visitSession.upsert as any).mock.calls[0][0];
    expect(upsert.update).toMatchObject({ jsConfirmed: true, screen: "1920x1080" });
  });

  it("авторизация внутри визита проставляется, но никогда не сбрасывается", async () => {
    await recordHit(hit({ authed: false }));
    expect((prisma.visitSession.upsert as any).mock.calls[0][0].update.authed).toBeUndefined();
    await recordHit(hit({ authed: true, userId: "u1" }));
    expect((prisma.visitSession.upsert as any).mock.calls[1][0].update).toMatchObject({ authed: true, userId: "u1" });
  });

  it("падение БД не пробрасывается наружу: аналитика не имеет права ломать запрос", async () => {
    (prisma.pageView.create as any).mockRejectedValue(new Error("db down"));
    expect(await recordHit(hit())).toBe("skipped");
  });

  it("сбор можно выключить переменной окружения", async () => {
    process.env.ANALYTICS_ENABLED = "false";
    expect(await recordHit(hit())).toBe("skipped");
    expect(prisma.pageView.create).not.toHaveBeenCalled();
    delete process.env.ANALYTICS_ENABLED;
  });
});

describe("floodCheck", () => {
  it("режет шквал запросов одного посетителя и открывается в следующем окне", () => {
    const key = `flood-${Math.random()}`;
    const t0 = 1_000_000;
    let allowed = 0;
    for (let i = 0; i < 300; i++) if (floodCheck(key, t0)) allowed++;
    expect(allowed).toBe(240);
    expect(floodCheck(key, t0 + 61_000)).toBe(true);
  });
});

describe("markConversion", () => {
  beforeEach(() => vi.clearAllMocks());

  it("отмечает регистрацию на визите", async () => {
    await markConversion("s1", "registered", "u1");
    expect(prisma.visitSession.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { registered: true, authed: true, userId: "u1" },
    });
  });

  it("без визита ничего не делает и не падает", async () => {
    await markConversion(null, "loggedIn");
    expect(prisma.visitSession.update).not.toHaveBeenCalled();
    (prisma.visitSession.update as any).mockRejectedValue(new Error("no row"));
    await expect(markConversion("gone", "loggedIn")).resolves.toBeUndefined();
  });
});

describe("retentionDays", () => {
  it("по умолчанию 90 суток, переопределяется переменной окружения", () => {
    expect(retentionDays()).toBe(90);
    process.env.ANALYTICS_RETENTION_DAYS = "30";
    expect(retentionDays()).toBe(30);
    process.env.ANALYTICS_RETENTION_DAYS = "чепуха";
    expect(retentionDays()).toBe(90);
    delete process.env.ANALYTICS_RETENTION_DAYS;
  });
});
