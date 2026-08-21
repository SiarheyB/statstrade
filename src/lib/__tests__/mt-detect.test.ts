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

  // Терминал сохраняет отчёт на языке интерфейса: в русской выгрузке нет ни
  // одного английского слова, и раньше такой файл не опознавался вовсе.
  describe("русские отчёты", () => {
    it("узнаёт MT5 по разделам «Позиции» и «Сделки»", () => {
      expect(detectFormat("<div>Позиции</div><div>Ордера</div><div>Сделки</div>")).toBe("mt5");
    });

    it("узнаёт MT5 по колонке «Направление»", () => {
      expect(detectFormat("<th>Направление</th>")).toBe("mt5");
    });

    it("узнаёт MT4 по «Тикет» + «Инструмент»", () => {
      expect(detectFormat("<th>Тикет</th><th>Инструмент</th>")).toBe("mt4");
    });
  });
});
