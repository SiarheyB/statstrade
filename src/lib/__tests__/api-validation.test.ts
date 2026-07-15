import { describe, it, expect } from "vitest";
import { unauthorized, badRequest, serverError, tooManyRequests, sharedCacheHeaders } from "@/lib/api";

describe("API validation/response helpers", () => {
  it("unauthorized returns 401 with the standard message", async () => {
    const res = unauthorized();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Не авторизован" });
  });

  it("badRequest returns 400 with the message and no details when omitted", async () => {
    const res = badRequest("boom");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "boom", details: undefined });
  });

  it("badRequest carries structured details when provided", async () => {
    const details = { field: ["too short"] };
    const res = badRequest("Проверьте данные", details);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Проверьте данные", details });
  });

  it("serverError returns a generic 500 (hides internals)", async () => {
    const res = serverError("SELECT * FROM users WHERE secret");
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Внутренняя ошибка сервера");
    expect(body.error).not.toContain("SELECT");
  });

  it("tooManyRequests returns 429 with Retry-After header", () => {
    const res = tooManyRequests(30);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
  });

  it("sharedCacheHeaders builds a public Cache-Control with SWR", () => {
    const headers = sharedCacheHeaders(60, 120) as Record<string, string>;
    expect(headers["Cache-Control"]).toBe("public, max-age=60, s-maxage=60, stale-while-revalidate=120");
  });
});
