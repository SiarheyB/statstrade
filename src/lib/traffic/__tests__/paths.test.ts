import { describe, it, expect } from "vitest";
import { isTrackablePath, normalizePath } from "@/lib/traffic/paths";

describe("isTrackablePath", () => {
  it("страницы считаем", () => {
    expect(isTrackablePath("/")).toBe(true);
    expect(isTrackablePath("/dashboard/trades")).toBe(true);
    expect(isTrackablePath("/news")).toBe(true);
  });

  it("API и статику — нет", () => {
    expect(isTrackablePath("/api/stats")).toBe(false);
    expect(isTrackablePath("/_next/static/chunk.js")).toBe(false);
    expect(isTrackablePath("/favicon.ico")).toBe(false);
    expect(isTrackablePath("/bg-midnight.svg")).toBe(false);
  });
});

describe("normalizePath", () => {
  it("режет query, хвостовой слэш", () => {
    expect(normalizePath("/news?utm_source=tg")).toBe("/news");
    expect(normalizePath("/news/")).toBe("/news");
    expect(normalizePath("")).toBe("/");
  });

  it("прячет токен публичной ссылки — он и есть ключ доступа", () => {
    expect(normalizePath("/share/9f2c8a1b7e4d")).toBe("/share/[token]");
  });

  it("схлопывает идентификаторы в шаблон маршрута", () => {
    expect(normalizePath("/admin/users/clz9x8y7w6v5u4t3s2r1q0p9")).toBe("/admin/users/[id]");
    expect(normalizePath("/admin/support/ticket-42/messages")).toBe("/admin/support/[ticketId]");
  });

  it("незнакомый маршрут с id тоже схлопывается", () => {
    expect(normalizePath("/thing/550e8400-e29b-41d4-a716-446655440000")).toBe("/thing/[id]");
    expect(normalizePath("/thing/12345")).toBe("/thing/[id]");
  });
});
