import { describe, it, expect } from "vitest";
import { gzipSync } from "node:zlib";
import { gunzipIfNeeded, isGzip } from "../gzip";

describe("gunzipIfNeeded", () => {
  it("несжатый файл возвращает как есть", () => {
    const b = Buffer.from("<html>Ticket</html>");
    expect(gunzipIfNeeded(b, 1000)).toBe(b);
    expect(isGzip(b)).toBe(false);
  });
  it("распаковывает gzip", () => {
    const src = "<html>Ticket</html>".repeat(50);
    expect(gunzipIfNeeded(gzipSync(src), 100000).toString()).toBe(src);
  });
  it("бросает, если распакованное больше лимита", () => {
    expect(() => gunzipIfNeeded(gzipSync("a".repeat(5000)), 1000)).toThrow();
  });
  it("бросает на битом архиве", () => {
    expect(() => gunzipIfNeeded(Buffer.from([0x1f, 0x8b, 1, 2, 3, 4]), 1000)).toThrow();
  });
});
