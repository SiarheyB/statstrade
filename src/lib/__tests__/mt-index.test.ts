import { describe, it, expect } from "vitest";

// Импорт через баррель @/lib/mt покрывает re-export'ы в mt/index.ts
// (detectFormat / parseStatement / типы).
import * as mt from "@/lib/mt";

describe("mt barrel (index)", () => {
  it("re-exports detectFormat and parseStatement", () => {
    expect(typeof mt.detectFormat).toBe("function");
    expect(typeof mt.parseStatement).toBe("function");
    // smoke: detectFormat доступен через баррель
    expect(mt.detectFormat("<html>MetaTrader 5 report</html>")).toBe("mt5");
  });
});
