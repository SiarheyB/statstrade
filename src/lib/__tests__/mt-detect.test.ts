import { describe, it, expect } from "vitest";
import { detectFormat } from "@/lib/mt/detect";

describe("detectFormat", () => {
  it("detects MT5 from explicit version signature", () => {
    expect(detectFormat("<html>MetaTrader 5 report</html>")).toBe("mt5");
  });

  it("detects MT5 from positions+deals columns", () => {
    expect(detectFormat("positions deals")).toBe("mt5");
  });

  it("detects MT4 from ticket column", () => {
    expect(detectFormat("<th>ticket</th>")).toBe("mt4");
  });

  it("detects MT4 from ticket+item keywords", () => {
    expect(detectFormat("ticket item")).toBe("mt4");
  });

  it("prefers MT5 when only a position column is present", () => {
    expect(detectFormat(">position<")).toBe("mt5");
  });

  it("returns unknown when nothing matches", () => {
    expect(detectFormat("hello world")).toBe("unknown");
  });
});
