// @vitest-environment node
// jose требует «настоящий» Uint8Array: TextEncoder из jsdom отдаёт объект из
// другого реалма, и подпись падает на проверке типа.
import { describe, it, expect, beforeAll } from "vitest";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";
import { middleware } from "@/middleware";

// Демо-сессия («посмотреть без регистрации») ходит по общему аккаунту, поэтому
// запрет на изменения — не косметика, а единственное, что мешает первому же
// гостю его испортить. Гард живёт в middleware: роутов с мутациями семь
// десятков, и точечные проверки в них рано или поздно забудут добавить.

const SECRET = "test-secret-for-middleware";

async function token(claims: Record<string, unknown>): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(SECRET));
}

function request(path: string, method: string, jwt: string): NextRequest {
  const req = new NextRequest(`https://example.com${path}`, { method });
  req.cookies.set("ts_session", jwt);
  return req;
}

const demoClaims = { userId: "demo-1", email: "demo@tradestats.local", demo: true, v: 0 };
const userClaims = { userId: "u-1", email: "user@example.com", demo: false, v: 0 };

describe("middleware: демо-режим только для чтения", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = SECRET;
  });

  it("пропускает GET от демо-сессии", async () => {
    const res = await middleware(request("/api/stats", "GET", await token(demoClaims)));
    expect(res.status).toBe(200);
  });

  it("отклоняет POST от демо-сессии", async () => {
    const res = await middleware(request("/api/accounts", "POST", await token(demoClaims)));
    expect(res.status).toBe(403);
  });

  it.each(["PUT", "PATCH", "DELETE"])("отклоняет %s от демо-сессии", async (method) => {
    const res = await middleware(request("/api/accounts/x", method, await token(demoClaims)));
    expect(res.status).toBe(403);
  });

  it("пропускает выход из демо — иначе из него было бы не выйти", async () => {
    const res = await middleware(request("/api/demo/exit", "POST", await token(demoClaims)));
    expect(res.status).toBe(200);
  });

  it("не трогает POST обычного пользователя", async () => {
    const res = await middleware(request("/api/accounts", "POST", await token(userClaims)));
    expect(res.status).toBe(200);
  });
});

// Спрятать пункт в меню недостаточно: адрес всё равно можно ввести руками, а
// через настройки демо-гость менял бы общий аккаунт (и таймзону в собственной
// cookie, которая переживала бы выход из демо).
describe("middleware: разделы, закрытые в демо", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = SECRET;
  });

  it.each([
    "/dashboard/settings",
    "/dashboard/settings/risk",
    "/dashboard/accounts",
    "/dashboard/playbooks",
    "/dashboard/orderflow",
    "/dashboard/liqmap",
    "/dashboard/recommendations",
    "/dashboard/forex",
    "/admin",
  ])("уводит демо-сессию с %s на обзор", async (path) => {
    const res = await middleware(request(path, "GET", await token(demoClaims)));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/dashboard");
  });

  it.each(["/api/admin/users", "/api/notifications", "/api/playbooks", "/api/orderflow/meta", "/api/recommendations"])(
    "закрывает и чтение %s — иначе раздел доступен в обход интерфейса",
    async (path) => {
      const res = await middleware(request(path, "GET", await token(demoClaims)));
      expect(res.status).toBe(403);
    },
  );

  it.each(["/dashboard", "/dashboard/analytics", "/dashboard/trades", "/dashboard/news", "/api/stats"])(
    "оставляет открытым %s",
    async (path) => {
      const res = await middleware(request(path, "GET", await token(demoClaims)));
      expect(res.status).toBe(200);
    },
  );

  it("обычному пользователю закрытые в демо разделы доступны", async () => {
    const res = await middleware(request("/dashboard/settings", "GET", await token(userClaims)));
    expect(res.status).toBe(200);
  });
});
