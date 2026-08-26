import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

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

import EconCalAlerts from "@/components/EconCalAlerts";
import { ALERT_DEMO_EVENT, ALERT_SETTINGS_KEY } from "@/lib/econcalAlerts";

// Компонент читает localStorage и дёргает календарь в эффектах, поэтому
// рендер оборачиваем в act — иначе React ругается на обновления вне него.
const mount = async () => {
  await act(async () => {
    render(<EconCalAlerts />);
  });
};

const events = (list: unknown[]) => ({
  ok: true,
  json: async () => ({ events: list, currencies: [], categories: [] }),
});

describe("EconCalAlerts", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(async () => events([])));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ничего не рисует, пока не пришло ни одного напоминания", async () => {
    await mount();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("показывает тестовое окно из настроек и закрывает его по кнопке", async () => {
    await mount();
    act(() => {
      window.dispatchEvent(new CustomEvent(ALERT_DEMO_EVENT));
    });

    const toast = await screen.findByRole("alert");
    expect(toast).toHaveTextContent("econcalAlerts.demoTag");
    // Название события переведено словарём терминов, а не показано как есть.
    expect(toast).toHaveTextContent(/Занятость вне сельского хозяйства/);

    fireEvent.click(screen.getByRole("button", { name: "econcalAlerts.dismiss" }));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("не опрашивает календарь при выключенных уведомлениях", async () => {
    localStorage.setItem(ALERT_SETTINGS_KEY, JSON.stringify({ enabled: false }));
    await mount();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("опрашивает календарь, когда уведомления включены", async () => {
    await mount();
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/api/econcal?from="));
  });
});
