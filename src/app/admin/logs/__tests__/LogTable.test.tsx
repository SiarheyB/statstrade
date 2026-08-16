import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LogTable } from "../components/LogTable";

// В таблице сообщение обрезано по ширине колонки, а у ошибок синка весь смысл
// как раз в хвосте: полный URL, код ответа биржи и стек. Раскрытие строки —
// единственный способ его прочитать, не лезя в базу.
const LONG =
  "Failed to sync spot: bybit GET https://api-demo.bybit.com/v5/execution/list?category=spot&limit=100 401 Unauthorized";

const log = {
  id: "1",
  module: "sync",
  accountId: "cmqwmmnqy0001qh1ybbzbpvu6",
  eventType: "TASK_FAILED",
  message: LONG,
  details: { exchangeId: "bybit", kind: "spot", error: LONG },
  level: "error" as const,
  timestamp: "2026-08-14T14:49:22.000Z",
};

describe("LogTable", () => {
  it("раскрывает полное сообщение и детали по клику на строку", () => {
    render(<LogTable logs={[log]} />);

    // В свёрнутом виде текст один — в обрезанной ячейке.
    expect(screen.getAllByText(LONG)).toHaveLength(1);
    expect(screen.queryByText("Детали")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("TASK_FAILED"));

    expect(screen.getByText("Полный текст")).toBeInTheDocument();
    expect(screen.getByText("Детали")).toBeInTheDocument();
    expect(screen.getAllByText(LONG).length).toBeGreaterThan(1);
    expect(screen.getByText(/"exchangeId": "bybit"/)).toBeInTheDocument();
  });

  it("повторный клик сворачивает строку", () => {
    render(<LogTable logs={[log]} />);
    const row = screen.getByText("TASK_FAILED");

    fireEvent.click(row);
    expect(screen.getByText("Полный текст")).toBeInTheDocument();

    fireEvent.click(row);
    expect(screen.queryByText("Полный текст")).not.toBeInTheDocument();
  });

  it("чекбокс выбора не раскрывает строку", () => {
    render(<LogTable logs={[log]} onDelete={() => {}} />);

    // Первый чекбокс — «выбрать все», второй — сама строка.
    fireEvent.click(screen.getAllByRole("checkbox")[1]);

    expect(screen.queryByText("Полный текст")).not.toBeInTheDocument();
    expect(screen.getByText(/Выбрано: 1/)).toBeInTheDocument();
  });
});
