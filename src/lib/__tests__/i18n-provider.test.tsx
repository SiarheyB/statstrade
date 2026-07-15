import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push: vi.fn() }),
}));

import { I18nProvider, useI18n } from "@/lib/i18n/provider";

function Consumer() {
  const { locale, t, setLocale, setTimezone, timezone } = useI18n();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="tz">{timezone}</span>
      <span data-testid="t">{String(t("app.title", { n: 3 }))}</span>
      <button onClick={() => setLocale("en")}>setEn</button>
      <button onClick={() => setTimezone("UTC")}>setTz</button>
    </div>
  );
}

describe("I18nProvider / useI18n", () => {
  beforeEach(() => {
    refresh.mockClear();
    document.documentElement.lang = "";
  });

  it("provides locale/timezone/t and renders children", () => {
    render(
      <I18nProvider locale="ru" timezone="UTC+3">
        <Consumer />
      </I18nProvider>,
    );
    expect(screen.getByTestId("locale").textContent).toBe("ru");
    expect(screen.getByTestId("tz").textContent).toBe("UTC+3");
    expect(typeof screen.getByTestId("t").textContent).toBe("string");
  });

  it("setLocale writes the cookie, updates lang and refreshes the router", () => {
    render(
      <I18nProvider locale="ru" timezone="UTC+3">
        <Consumer />
      </I18nProvider>,
    );
    act(() => {
      screen.getByText("setEn").click();
    });
    expect(refresh).toHaveBeenCalled();
    expect(document.cookie).toContain("ts_locale=en");
    expect(document.documentElement.lang).toBe("en");
    expect(screen.getByTestId("locale").textContent).toBe("en");
  });

  it("setTimezone normalizes and writes the cookie", () => {
    render(
      <I18nProvider locale="ru" timezone="UTC+3">
        <Consumer />
      </I18nProvider>,
    );
    act(() => {
      screen.getByText("setTz").click();
    });
    expect(document.cookie).toContain("ts_timezone=UTC");
    expect(screen.getByTestId("tz").textContent).toBe("UTC");
  });
});
