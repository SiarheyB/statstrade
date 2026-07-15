import { describe, it, expect } from "vitest";
import { parseNum, parseMtDate } from "@/lib/mt/numbers";

describe("parseNum", () => {
  it("returns 0 for blank/invalid input", () => {
    expect(parseNum(undefined)).toBe(0);
    expect(parseNum(null)).toBe(0);
    expect(parseNum("")).toBe(0);
    expect(parseNum("-")).toBe(0);
    expect(parseNum("abc")).toBe(0);
  });

  it("parses plain integers and decimals", () => {
    expect(parseNum("1234")).toBe(1234);
    expect(parseNum("50.00")).toBe(50);
    expect(parseNum("-12.5")).toBe(-12.5);
  });

  it("treats comma as decimal separator when no dot present", () => {
    expect(parseNum("1234,56")).toBe(1234.56);
    expect(parseNum("-50,00")).toBe(-50);
  });

  it("treats comma as thousands separator when both are present", () => {
    expect(parseNum("1,234.56")).toBe(1234.56);
    expect(parseNum("1 234.56".replace(" ", " "))).toBe(1234.56);
  });
});

describe("parseMtDate", () => {
  it("returns null for blank input", () => {
    expect(parseMtDate(undefined)).toBeNull();
    expect(parseMtDate("")).toBeNull();
    expect(parseMtDate("not a date")).toBeNull();
  });

  it("parses dot-separated date + time as UTC", () => {
    const d = parseMtDate("2024.05.13 14:30:05");
    expect(d).not.toBeNull();
    expect(d!.toISOString()).toBe("2024-05-13T14:30:05.000Z");
  });

  it("parses dash-separated date with seconds", () => {
    const d = parseMtDate("2024-05-13 14:30:05");
    expect(d!.toISOString()).toBe("2024-05-13T14:30:05.000Z");
  });

  it("parses time without seconds", () => {
    const d = parseMtDate("2024.05.13 14:30");
    expect(d!.toISOString()).toBe("2024-05-13T14:30:00.000Z");
  });
});
