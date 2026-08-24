/**
 * Тесты для SessionPicker — меню включения торговых сессий.
 * src/components/SessionPicker.tsx
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import SessionPicker from "@/components/SessionPicker";
import type { SessionId } from "@/lib/tradingSessions";

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
        "fx.sessions": "Сессии",
        "fx.sessionsTitle": "Торговые сессии",
        "fx.hintSessions": "Подсветка сессий",
        "fx.sessionTokyo": "Токио",
        "fx.sessionLondon": "Лондон",
        "fx.sessionNewYork": "Нью-Йорк",
      })[key] ?? key,
    timezone: "UTC",
  }),
}));

function setup(over: Partial<React.ComponentProps<typeof SessionPicker>> = {}) {
  const props = {
    value: [] as SessionId[],
    onToggle: vi.fn(),
    timezone: "UTC",
    ...over,
  };
  render(<SessionPicker {...props} />);
  return props;
}

describe("SessionPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 24 августа 2026 — летнее время и в Лондоне, и в Нью-Йорке
    vi.setSystemTime(new Date("2026-08-24T12:00:00Z"));
  });

  it("меню закрыто, пока не нажали кнопку", () => {
    setup();
    expect(screen.queryByText("Торговые сессии")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Сессии/ }));
    expect(screen.getByText("Торговые сессии")).toBeInTheDocument();
    expect(screen.getByText("Токио")).toBeInTheDocument();
    expect(screen.getByText("Лондон")).toBeInTheDocument();
    expect(screen.getByText("Нью-Йорк")).toBeInTheDocument();
  });

  it("часы показаны в таймзоне пользователя", () => {
    setup({ timezone: "UTC" });
    fireEvent.click(screen.getByRole("button", { name: /Сессии/ }));
    // Лондон летом: 08:00 BST = 07:00 UTC, закрытие 17:00 BST = 16:00 UTC
    expect(screen.getByText("07:00 – 16:00")).toBeInTheDocument();
    // Токио круглый год 09:00–18:00 JST = 00:00–09:00 UTC
    expect(screen.getByText("00:00 – 09:00")).toBeInTheDocument();
  });

  it("та же сессия в UTC+3 сдвигается на три часа", () => {
    setup({ timezone: "UTC+3" });
    fireEvent.click(screen.getByRole("button", { name: /Сессии/ }));
    expect(screen.getByText("10:00 – 19:00")).toBeInTheDocument(); // Лондон
    expect(screen.getByText("03:00 – 12:00")).toBeInTheDocument(); // Токио
  });

  it("клик по строке переключает сессию", () => {
    const props = setup();
    fireEvent.click(screen.getByRole("button", { name: /Сессии/ }));
    fireEvent.click(screen.getByText("Лондон"));
    expect(props.onToggle).toHaveBeenCalledWith("london");
  });

  it("включённые сессии отмечены и посчитаны на кнопке", () => {
    setup({ value: ["tokyo", "newYork"] });
    const btn = screen.getByRole("button", { name: /Сессии/ });
    expect(btn).toHaveTextContent("2");
    fireEvent.click(btn);
    expect(screen.getByText("Токио").closest("button")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Лондон").closest("button")).toHaveAttribute("aria-pressed", "false");
  });

  it("Escape закрывает меню", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /Сессии/ }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("Торговые сессии")).toBeNull();
  });
});
