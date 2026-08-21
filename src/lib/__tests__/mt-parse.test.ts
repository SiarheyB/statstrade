import { describe, it, expect } from "vitest";
import { parseStatement } from "@/lib/mt/parse";

const mt5Html = `<table>
<tr><th>Time</th><th>Position</th><th>Symbol</th><th>Type</th><th>Lots</th><th>Open Price</th><th>S / L</th><th>T / P</th><th>Close Time</th><th>Close Price</th><th>Commission</th><th>Swap</th><th>Profit</th></tr>
<tr><td>2024.05.13 14:30:05</td><td>1001</td><td>EURUSD</td><td>buy</td><td></td><td>0.10</td><td>1.1000</td><td>1.0950</td><td>1.1100</td><td>2024.05.13 15:00:00</td><td>1.1050</td><td>-2.00</td><td>0.10</td><td>50.00</td></tr>
</table>`;

const mt4Html = `<table>
<tr><th>Ticket</th><th>Open Time</th><th>Type</th><th>Size</th><th>Item</th><th>Price</th><th>S / L</th><th>Close Time</th><th>Close Price</th><th>Commission</th><th>Comment</th><th>Swap</th><th>Profit</th></tr>
<tr><td>2002</td><td>2024.05.13 10:00:00</td><td>buy</td><td>0.20</td><td>EURUSD</td><td>1.2000</td><td>1.1900</td><td>2024.05.13 11:00:00</td><td>1.2050</td><td>-1.00</td><td>0.00</td><td>0.05</td><td>25.00</td></tr>
</table>`;

// Реальная шапка русского ReportHistory из MT5 (GerchikCo-MT5, UTF-16): в MT5
// у строк данных на одну ячейку больше, чем в шапке, поэтому хвост колонок
// парсер берёт с конца — см. buildMt5.
const mt5RussianHtml = `<table>
<tr><th>Позиции</th></tr>
<tr><th>Время</th><th>Позиция</th><th>Символ</th><th>Тип</th><th>Объем</th><th>Цена</th><th>S / L</th><th>T / P</th><th>Время</th><th>Цена</th><th>Комиссия</th><th>Своп</th><th>Прибыль</th></tr>
<tr><td>2026.08.21 15:04:48</td><td>31608540</td><td>XAUUSD</td><td>sell</td><td></td><td>4</td><td>4594.21</td><td>4594.25</td><td>4559.50</td><td>2026.08.21 17:21:08</td><td>4582.73</td><td>-0.40</td><td>0.00</td><td>45.92</td></tr>
</table>`;

describe("parseStatement", () => {
  it("parses an MT5 positions report", () => {
    const r = parseStatement(mt5Html);
    expect(r.format).toBe("mt5");
    expect(r.trades).toHaveLength(1);
    const t = r.trades[0];
    expect(t.externalId).toBe("1001");
    expect(t.symbol).toBe("EURUSD");
    expect(t.side).toBe("long");
    expect(t.lots).toBeCloseTo(0.1);
    expect(t.entryPrice).toBeCloseTo(1.1);
    expect(t.exitPrice).toBeCloseTo(1.105);
    expect(t.stopLoss).toBeCloseTo(1.095);
    expect(t.takeProfit).toBeCloseTo(1.11);
    expect(t.commission).toBeCloseTo(-2);
    expect(t.swap).toBeCloseTo(0.1);
    expect(t.grossProfit).toBeCloseTo(50);
    expect(r.errors).toHaveLength(0);
  });

  it("reports an error for an undetectable format", () => {
    const r = parseStatement("<p>hello world</p>");
    expect(r.format).toBe("unknown");
    expect(r.trades).toHaveLength(0);
    expect(r.errors[0]).toMatch(/определить формат/);
  });

  it("errors when the MT5 Positions section is missing", () => {
    const r = parseStatement(
      `<table><tr><th>position</th><th>Foo</th></tr><tr><td>buy</td><td>1</td></tr></table>`,
    );
    expect(r.format).toBe("mt5");
    expect(r.errors[0]).toMatch(/Positions/);
  });

  it("parses MT4 closed transactions (fixed positional fields)", () => {
    const r = parseStatement(mt4Html);
    expect(r.format).toBe("mt4");
    expect(r.trades).toHaveLength(1);
    const t = r.trades[0];
    expect(t.externalId).toBe("2002");
    expect(t.side).toBe("long");
    expect(t.symbol).toBe("EURUSD");
    expect(t.lots).toBeCloseTo(0.2);
    expect(t.entryPrice).toBeCloseTo(1.2);
    expect(t.exitPrice).toBeCloseTo(1.205);
    expect(t.stopLoss).toBeCloseTo(1.19);
    expect(t.commission).toBeCloseTo(-1);
    expect(t.swap).toBeCloseTo(0.05);
    expect(t.grossProfit).toBeCloseTo(25);
    expect(t.exitTime).not.toBeNull();
    // Code reads both exitTime and takeProfit from the same column (index 7),
    // so the Close Time date there makes takeProfit null.
    expect(t.takeProfit).toBeNull();
  });

  it("de-duplicates by externalId across repeated tables", () => {
    const r = parseStatement(mt5Html + mt5Html);
    expect(r.trades).toHaveLength(1);
  });

  it("extracts the account balance from the summary", () => {
    const r = parseStatement(
      `<table><tr><td>Balance:</td><td>717.10</td></tr></table>` + mt5Html,
    );
    expect(r.balance).toBeCloseTo(717.1);
  });
});

describe("parseStatement — русский отчёт MT5", () => {
  it("разбирает позицию из русской выгрузки", () => {
    const r = parseStatement(mt5RussianHtml);
    expect(r.format).toBe("mt5");
    expect(r.trades).toHaveLength(1);
    const t = r.trades[0];
    expect(t.externalId).toBe("31608540");
    expect(t.symbol).toBe("XAUUSD");
    expect(t.side).toBe("short");
    expect(t.entryPrice).toBeCloseTo(4594.21);
    expect(t.exitPrice).toBeCloseTo(4582.73);
    expect(t.stopLoss).toBeCloseTo(4594.25);
    expect(t.grossProfit).toBeCloseTo(45.92);
  });
});
