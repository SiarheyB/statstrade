import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@/lib/i18n/provider", () => ({
  useI18n: () => ({
    timezone: "auto",
    setTimezone: vi.fn(),
    setLocale: vi.fn(),
    locale: "ru",
    t: (k: string, vars?: Record<string, string | number>) =>
      vars ? `${k}:${Object.values(vars).join(",")}` : k,
  }),
  I18nProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import EconCalAlertSettings from "@/components/EconCalAlertSettings";
import { ALERT_SETTINGS_KEY, loadAlertSettings } from "@/lib/econcalAlerts";

describe("EconCalAlertSettings", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("сохраняет выбранный рубеж в localStorage", () => {
    render(<EconCalAlertSettings />);
    fireEvent.click(screen.getByRole("button", { name: /leadMinutes:10/ }));
    expect(loadAlertSettings().leads).toContain(10);
    expect(JSON.parse(localStorage.getItem(ALERT_SETTINGS_KEY)!).leads).toContain(10);
  });

  it("не даёт снять последнюю важность — иначе уведомления молчали бы молча", () => {
    render(<EconCalAlertSettings />);
    // по умолчанию выбрана только «высокая»
    fireEvent.click(screen.getByRole("button", { name: /econcal\.impact\.high/ }));
    expect(loadAlertSettings().impacts).toEqual(["high"]);
  });

  it("фильтр по валютам пуст по умолчанию и переключается", () => {
    render(<EconCalAlertSettings />);
    expect(loadAlertSettings().currencies).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: /EUR/ }));
    expect(loadAlertSettings().currencies).toEqual(["EUR"]);
    fireEvent.click(screen.getByRole("button", { name: /EUR/ }));
    expect(loadAlertSettings().currencies).toEqual([]);
  });

  it("главный выключатель гасит уведомления", () => {
    render(<EconCalAlertSettings />);
    const toggles = screen.getAllByRole("switch");
    fireEvent.click(toggles[0]);
    expect(loadAlertSettings().enabled).toBe(false);
  });
});
